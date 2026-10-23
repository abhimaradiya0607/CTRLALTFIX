import { randomUUID } from "node:crypto";
import type { TemplateFolder } from "../../playground/types/index.ts";
import { chunkCollectionForModel, type ChunkCollection } from "./embedding-target.ts";
import {
  EmbeddingProviderError,
  EmbeddingValidationError,
  validateEmbeddingVectors,
  type ChunkEmbeddingRecord,
  type EmbeddingProvider,
} from "./embed-chunks.ts";
import type { EmbeddingIndexConfig, IndexedFileRecord } from "./index-plan.ts";
import { buildIndexUpdate } from "./pipeline.ts";

/**
 * Persistence strategy (see prisma/schema.prisma):
 *  1. Insert new chunks under a fresh runId. Nothing reads them yet.
 *  2. Commit: replace the manifest (path -> hash + runId) in ONE single-document write.
 *     That write is the moment the new index becomes visible, and it is atomic.
 *  3. Best-effort cleanup of chunks no manifest entry points to.
 * A failure before step 2 leaves the previous index fully intact.
 *
 * Every run records the index version it started from (`baseVersion`). The commit only
 * succeeds if the version is unchanged, so once version N is committed, every run that
 * started from a version below N can never commit. Cleanup uses exactly that fact and no clock.
 */

export interface ManifestFile {
  path: string;
  contentHash: string;
  runId: string;
}

export interface StoredIndex {
  version: number;
  embeddingModel: string;
  embeddingDimensions: number;
  files: ManifestFile[];
  /** Set only when a cross-collection switch published over this manifest. */
  previousEmbeddingModel?: string | null;
  previousEmbeddingDimensions?: number | null;
  previousFiles?: ManifestFile[];
}

export interface ChunkRef {
  id: string;
  path: string;
  runId: string;
  baseVersion: number;
}

/** Everything the service needs from the database. Implemented with Prisma in prisma-index-store.ts. */
export interface IndexStore {
  loadIndex(playgroundId: string): Promise<StoredIndex | null>;
  insertChunks(input: {
    playgroundId: string;
    userId: string;
    runId: string;
    /** Index version this run read (0 when no index existed). */
    baseVersion: number;
    records: ChunkEmbeddingRecord[];
    /** Omitted means the Ollama collection, so older callers keep writing RagChunk. */
    collection?: ChunkCollection;
  }): Promise<void>;
  /**
   * Returns false when `expectedVersion` no longer matches (another run committed first).
   * `previous` undefined leaves any saved rollback manifest in place.
   * `previous` null clears it. An object publishes that manifest as the rollback slot.
   */
  commitIndex(input: {
    playgroundId: string;
    userId: string;
    expectedVersion: number | null;
    embedding: EmbeddingIndexConfig;
    files: ManifestFile[];
    previous?: { model: string; dimensions: number; files: ManifestFile[] } | null;
  }): Promise<boolean>;
  /** Restores the saved manifest and clears the rollback slot. Does not delete chunks. */
  rollbackIndex(input: {
    playgroundId: string;
    expectedVersion: number;
    embedding: EmbeddingIndexConfig;
    files: ManifestFile[];
  }): Promise<boolean>;
  listChunkRefs(playgroundId: string, collection?: ChunkCollection): Promise<ChunkRef[]>;
  deleteChunks(ids: string[]): Promise<void>;
  deleteRunChunks(playgroundId: string, runId: string, collection?: ChunkCollection): Promise<void>;
}

export interface OwnedProject {
  id: string;
  userId: string;
}

export interface IndexProjectDeps {
  /** Must authenticate and check ownership. Never trusts a client-provided user. */
  getOwnedProject(
    playgroundId: string,
  ): Promise<
    | { decision: "allowed"; project: OwnedProject }
    | { decision: "unauthenticated" | "not-found" }
  >;
  loadSavedTree(playgroundId: string): Promise<unknown>;
  store: IndexStore;
  /** Called only after authorization. Throws when the provider is not configured. */
  createEmbedder(existing: StoredIndex | null): { embedder: EmbeddingProvider; model: string };
  newRunId?: () => string;
}

export type IndexProjectErrorCode =
  | "unauthenticated"
  | "not-found"
  | "no-saved-project"
  | "not-configured"
  | "provider-failed"
  | "invalid-embeddings"
  | "storage-failed"
  | "conflict"
  | "rollback-required"
  | "nothing-to-roll-back";

export type IndexProjectResult =
  | {
      status: "ok";
      embeddedFiles: number;
      embeddedChunks: number;
      skippedFiles: number;
      deletedFiles: number;
      model: string;
      dimensions: number;
    }
  | { status: "error"; code: IndexProjectErrorCode; message: string };

const PROBE_TEXT = "dimension probe";

const ERROR_MESSAGES: Record<IndexProjectErrorCode, string> = {
  unauthenticated: "You must be signed in to index a project.",
  "not-found": "Project not found.",
  "no-saved-project": "This project has no saved files to index yet.",
  "not-configured": "The embedding service is not configured on the server.",
  "provider-failed": "The embedding service is unavailable or returned an error. The existing index was not changed.",
  "invalid-embeddings": "The embedding service returned invalid data. The existing index was not changed.",
  "storage-failed": "Saving the index failed. The existing index was not changed.",
  conflict: "Another indexing run finished first. Please try again.",
  "rollback-required": "Roll this project back before switching embedding models again.",
  "nothing-to-roll-back": "This project has no saved previous index.",
};

function fail(code: IndexProjectErrorCode): IndexProjectResult {
  return { status: "error", code, message: ERROR_MESSAGES[code] };
}

function looksLikeTree(value: unknown): value is TemplateFolder {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

/**
 * Embeds one tiny constant string to learn the model's real vector size.
 * Dimensions are never guessed from the model name, and this also fails fast
 * (before any database write) when the provider is unreachable.
 */
async function resolveEmbeddingConfig(
  embedder: EmbeddingProvider,
  model: string,
): Promise<EmbeddingIndexConfig> {
  const vectors = await embedder.embedTexts([PROBE_TEXT]);
  const { dimensions } = validateEmbeddingVectors(vectors, 1);
  return { model, dimensions };
}

function manifestKey(path: string, runId: string): string {
  return `${path}\u0000${runId}`;
}

export async function indexProject(
  playgroundId: string,
  deps: IndexProjectDeps,
): Promise<IndexProjectResult> {
  const access = await deps.getOwnedProject(playgroundId);
  if (access.decision !== "allowed") return fail(access.decision);
  const { project } = access;

  let tree: unknown;
  let existing: StoredIndex | null;
  try {
    tree = await deps.loadSavedTree(project.id);
    existing = await deps.store.loadIndex(project.id);
  } catch (error) {
    logFailure("load", error);
    return fail("storage-failed");
  }
  if (!looksLikeTree(tree)) return fail("no-saved-project");

  let provider: { embedder: EmbeddingProvider; model: string };
  try {
    provider = deps.createEmbedder(existing);
  } catch (error) {
    logFailure("configure", error);
    return fail("not-configured");
  }

  const collection = chunkCollectionForModel(provider.model);
  const switchingCollection =
    existing !== null && chunkCollectionForModel(existing.embeddingModel) !== collection;
  if (existing && switchingCollection && existing.previousEmbeddingModel) {
    return fail("rollback-required");
  }

  // Phase 1: compute everything in memory. No database writes happen here.
  let update: Awaited<ReturnType<typeof buildIndexUpdate>>;
  let embedding: EmbeddingIndexConfig;
  try {
    embedding = await resolveEmbeddingConfig(provider.embedder, provider.model);
    const indexedFiles: IndexedFileRecord[] = (existing?.files ?? []).map((file) => ({
      path: file.path,
      contentHash: file.contentHash,
      embeddingModel: existing!.embeddingModel,
      embeddingDimensions: existing!.embeddingDimensions,
    }));
    update = await buildIndexUpdate({ tree, indexedFiles, embedding, embedder: provider.embedder });
  } catch (error) {
    logFailure("embed", error);
    return embedFailure(error);
  }

  const summary = {
    status: "ok" as const,
    embeddedFiles: update.embeddedFiles.length,
    embeddedChunks: update.records.length,
    skippedFiles: update.unchanged.length,
    deletedFiles: update.deletedPaths.length,
    model: embedding.model,
    dimensions: embedding.dimensions,
  };

  // Nothing changed: leave the stored index untouched. A changed model or vector size with no
  // files still needs a commit so the stored configuration never disagrees with the manifest.
  const configChanged =
    existing !== null &&
    (existing.embeddingModel !== embedding.model || existing.embeddingDimensions !== embedding.dimensions);
  if (existing && !configChanged && update.embeddedFiles.length === 0 && update.deletedPaths.length === 0) {
    return summary;
  }

  // Phase 2: write staging chunks, then commit the manifest in one atomic write.
  const runId = (deps.newRunId ?? randomUUID)();
  const baseVersion = existing?.version ?? 0;
  const previousRunByPath = new Map((existing?.files ?? []).map((f) => [f.path, f.runId]));
  const files: ManifestFile[] = [
    ...update.unchanged.map(({ path, contentHash }) => ({
      path,
      contentHash,
      runId: previousRunByPath.get(path) ?? runId,
    })),
    ...update.embeddedFiles.map(({ path, contentHash }) => ({ path, contentHash, runId })),
  ].sort((a, b) => a.path.localeCompare(b.path));

  try {
    await deps.store.insertChunks({
      playgroundId: project.id,
      userId: project.userId,
      runId,
      baseVersion,
      records: update.records,
      collection,
    });
  } catch (error) {
    // The commit was never attempted, so nothing references these chunks: safe to delete them.
    logFailure("stage", error);
    await discardRun(deps.store, project.id, runId, collection);
    return fail("storage-failed");
  }

  const previous = switchingCollection && existing
    ? {
        model: existing.embeddingModel,
        dimensions: existing.embeddingDimensions,
        files: existing.files.map((file) => ({ ...file })),
      }
    : undefined;

  try {
    const committed = await deps.store.commitIndex({
      playgroundId: project.id,
      userId: project.userId,
      expectedVersion: existing?.version ?? null,
      embedding,
      files,
      previous,
    });
    if (!committed) {
      // The version guard rejected the write, so our manifest was not applied: safe to discard.
      await discardRun(deps.store, project.id, runId, collection);
      return fail("conflict");
    }
  } catch (error) {
    logFailure("commit", error);
    // The write may have been applied even though the call failed (for example a network error
    // after the server acknowledged it). Deleting chunks of a committed run would leave the
    // manifest pointing at nothing, so only discard when we know the commit did not happen.
    if (await commitWasApplied(deps.store, project.id, runId)) {
      await cleanUp(deps, project.id, files, baseVersion + 1, collection, switchingCollection);
      return summary;
    }
    if (update.records.length > 0 && (await commitWasRejected(deps.store, project.id, runId))) {
      await discardRun(deps.store, project.id, runId, collection);
    }
    return fail("storage-failed");
  }

  await cleanUp(deps, project.id, files, baseVersion + 1, collection, switchingCollection);
  return summary;
}

/**
 * Puts the saved previous manifest back in one version-guarded write.
 * Chunks in both collections stay where they are.
 */
export async function rollbackProjectIndex(
  playgroundId: string,
  deps: Pick<IndexProjectDeps, "getOwnedProject" | "store">,
): Promise<IndexProjectResult> {
  const access = await deps.getOwnedProject(playgroundId);
  if (access.decision !== "allowed") return fail(access.decision);

  let existing: StoredIndex | null;
  try {
    existing = await deps.store.loadIndex(access.project.id);
  } catch (error) {
    logFailure("load", error);
    return fail("storage-failed");
  }
  if (
    !existing ||
    !existing.previousEmbeddingModel ||
    existing.previousEmbeddingDimensions == null
  ) {
    return fail("nothing-to-roll-back");
  }

  try {
    const restored = await deps.store.rollbackIndex({
      playgroundId: access.project.id,
      expectedVersion: existing.version,
      embedding: {
        model: existing.previousEmbeddingModel,
        dimensions: existing.previousEmbeddingDimensions,
      },
      files: existing.previousFiles ?? [],
    });
    if (!restored) return fail("conflict");
  } catch (error) {
    logFailure("rollback", error);
    return fail("storage-failed");
  }

  return {
    status: "ok",
    embeddedFiles: 0,
    embeddedChunks: 0,
    skippedFiles: existing.previousFiles?.length ?? 0,
    deletedFiles: 0,
    model: existing.previousEmbeddingModel,
    dimensions: existing.previousEmbeddingDimensions,
  };
}

/** Re-reads the index after an ambiguous commit failure. Returns true only if our run is in the manifest. */
async function commitWasApplied(store: IndexStore, playgroundId: string, runId: string): Promise<boolean> {
  try {
    const current = await store.loadIndex(playgroundId);
    return current?.files.some((file) => file.runId === runId) ?? false;
  } catch {
    return false;
  }
}

/** True only when a successful re-read proves our run is absent from the manifest. */
async function commitWasRejected(store: IndexStore, playgroundId: string, runId: string): Promise<boolean> {
  try {
    const current = await store.loadIndex(playgroundId);
    return !(current?.files.some((file) => file.runId === runId) ?? false);
  } catch {
    return false; // Unknown outcome: keep the chunks. Unreferenced chunks are harmless and swept later.
  }
}

async function discardRun(
  store: IndexStore,
  playgroundId: string,
  runId: string,
  collection: ChunkCollection,
): Promise<void> {
  try {
    await store.deleteRunChunks(playgroundId, runId, collection);
  } catch (error) {
    logFailure("discard", error); // Leftover staging chunks are unreferenced and swept by a later commit.
  }
}

/**
 * A collection switch keeps the other model's chunks. Cleanup then runs only inside
 * the collection that was just published, and only for a later same-model commit.
 */
async function cleanUp(
  deps: IndexProjectDeps,
  playgroundId: string,
  files: ManifestFile[],
  committedVersion: number,
  collection: ChunkCollection,
  switchingCollection: boolean,
): Promise<void> {
  if (switchingCollection) return;
  try {
    await removeStaleChunks(deps.store, playgroundId, files, committedVersion, collection);
  } catch (error) {
    logFailure("cleanup", error);
  }
}

function embedFailure(error: unknown): IndexProjectResult {
  if (error instanceof EmbeddingValidationError) return fail("invalid-embeddings");
  if (error instanceof EmbeddingProviderError && error.code === "not_configured") return fail("not-configured");
  return fail("provider-failed");
}

/**
 * Deletes chunks that the committed manifest does not reference AND whose run started from a
 * version below the one just committed. Such a run can never commit (its version guard would
 * fail), so its chunks are dead no matter how long ago they were written. Chunks from runs that
 * started from the current version may still commit, so they are never touched, regardless of age.
 */
async function removeStaleChunks(
  store: IndexStore,
  playgroundId: string,
  files: ManifestFile[],
  committedVersion: number,
  collection: ChunkCollection,
): Promise<void> {
  const referenced = new Set(files.map((f) => manifestKey(f.path, f.runId)));
  const refs = await store.listChunkRefs(playgroundId, collection);
  const staleIds = refs
    .filter((ref) => !referenced.has(manifestKey(ref.path, ref.runId)))
    .filter((ref) => ref.baseVersion < committedVersion)
    .map((ref) => ref.id);

  if (staleIds.length > 0) await store.deleteChunks(staleIds);
}

/** Logs only the error type, never messages that could contain source code or secrets. */
function logFailure(stage: string, error: unknown): void {
  const kind = error instanceof Error ? error.name : "UnknownError";
  console.error(`RAG indexing failed during ${stage}: ${kind}`);
}
