import {
  EmbeddingProviderError,
  EmbeddingValidationError,
  validateEmbeddingVectors,
  type EmbeddingProvider,
} from "./embed-chunks.ts";
import { isVoyageEmbeddingModel, vectorIndexForModel, chunkCollectionForModel } from "./embedding-target.ts";
import type { ChunkCollection } from "./embedding-target.ts";
import type { ManifestFile, OwnedProject, StoredIndex } from "./index-project.ts";

export const DEFAULT_RETRIEVAL_LIMIT = 5;
export const MAX_RETRIEVAL_LIMIT = 20;
export const MAX_QUESTION_CHARS = 4_000;

export interface RetrievedChunk {
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  score: number;
}

export interface VectorSearchQuery {
  playgroundId: string;
  queryVector: number[];
  limit: number;
  manifest: Pick<ManifestFile, "path" | "runId">[];
  indexName: string;
  collection: ChunkCollection;
  /** Present for Voyage searches so the query also filters on the stored model. */
  embeddingModel?: string;
}

/** Implemented with Atlas `$vectorSearch` in prisma-index-store.ts. Tests supply a fake. */
export interface VectorSearcher {
  search(input: VectorSearchQuery): Promise<unknown>;
}

export interface RetrieveDeps {
  getOwnedProject(
    playgroundId: string,
  ): Promise<{ decision: "allowed"; project: OwnedProject } | { decision: "unauthenticated" | "not-found" }>;
  loadIndex(playgroundId: string): Promise<StoredIndex | null>;
  /** Throws when the embedding provider is not configured. The stored index chooses the provider. */
  createEmbedder(index: StoredIndex): { embedder: EmbeddingProvider; model: string };
  searcher: VectorSearcher;
}

export type RetrieveErrorCode =
  | "unauthenticated"
  | "not-found"
  | "invalid-question"
  | "not-configured"
  | "model-mismatch"
  | "provider-failed"
  | "invalid-embeddings"
  | "search-failed"
  | "storage-failed";

export type RetrieveResult =
  | { status: "ok"; matches: RetrievedChunk[]; model: string; dimensions: number }
  | { status: "error"; code: RetrieveErrorCode; message: string };

const ERROR_MESSAGES: Record<RetrieveErrorCode, string> = {
  unauthenticated: "You must be signed in to search a project.",
  "not-found": "Project not found.",
  "invalid-question": "Enter a question of at most 4000 characters.",
  "not-configured": "The embedding service is not configured on the server.",
  "model-mismatch": "This project was indexed with a different embedding model. Re-index it before searching.",
  "provider-failed": "The embedding service is unavailable. No search was run.",
  "invalid-embeddings": "The embedding service returned a vector that does not match this project's index.",
  "search-failed": "Vector search failed. No results were returned.",
  "storage-failed": "The project index could not be read.",
};

function fail(code: RetrieveErrorCode): RetrieveResult {
  return { status: "error", code, message: ERROR_MESSAGES[code] };
}

export function clampRetrievalLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_RETRIEVAL_LIMIT;
  return Math.min(MAX_RETRIEVAL_LIMIT, Math.max(1, Math.floor(limit)));
}

function manifestKey(path: string, runId: string): string {
  return `${path}\u0000${runId}`;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value !== null) {
    const wrapped = value as { $numberDouble?: unknown; $numberInt?: unknown; $numberLong?: unknown };
    const raw = wrapped.$numberDouble ?? wrapped.$numberInt ?? wrapped.$numberLong;
    if (typeof raw === "string" && raw.trim() !== "") {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

interface ParsedHit extends RetrievedChunk {
  runId: string;
  chunkIndex: number;
}

/** Rejects a vector-search payload that is not a list of complete hits. */
export function parseVectorSearchHits(raw: unknown): ParsedHit[] {
  if (!Array.isArray(raw)) {
    throw new Error("Vector search response was not a list");
  }

  return raw.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new Error("Vector search hit was not an object");
    }
    const hit = item as Record<string, unknown>;
    const startLine = asFiniteNumber(hit.startLine);
    const endLine = asFiniteNumber(hit.endLine);
    const chunkIndex = asFiniteNumber(hit.chunkIndex);
    const score = asFiniteNumber(hit.score);
    if (typeof hit.path !== "string" || typeof hit.runId !== "string" || typeof hit.content !== "string") {
      throw new Error("Vector search hit is missing text fields");
    }
    if (
      startLine === null ||
      endLine === null ||
      chunkIndex === null ||
      score === null ||
      !Number.isInteger(startLine) ||
      !Number.isInteger(endLine) ||
      !Number.isInteger(chunkIndex) ||
      startLine < 1 ||
      endLine < startLine
    ) {
      throw new Error("Vector search hit has invalid line or score fields");
    }
    return { path: hit.path, runId: hit.runId, content: hit.content, startLine, endLine, chunkIndex, score };
  });
}

/**
 * Embeds one question and returns the closest committed chunks for a project.
 * Chunks are kept only when their path and runId appear in the current manifest,
 * so staged, stale, and losing-run rows cannot be returned.
 */
export async function retrieveProjectContext(
  playgroundId: string,
  question: string,
  deps: RetrieveDeps,
  limit?: number,
): Promise<RetrieveResult> {
  const access = await deps.getOwnedProject(playgroundId);
  if (access.decision !== "allowed") return fail(access.decision);

  const asked = typeof question === "string" ? question.trim() : "";
  if (asked.length === 0 || asked.length > MAX_QUESTION_CHARS) return fail("invalid-question");

  let index: StoredIndex | null;
  try {
    index = await deps.loadIndex(access.project.id);
  } catch (error) {
    logFailure("load", error);
    return fail("storage-failed");
  }
  if (!index || index.files.length === 0) {
    return { status: "ok", matches: [], model: index?.embeddingModel ?? "", dimensions: index?.embeddingDimensions ?? 0 };
  }

  let provider: { embedder: EmbeddingProvider; model: string };
  try {
    provider = deps.createEmbedder(index);
  } catch (error) {
    logFailure("configure", error);
    return fail("not-configured");
  }
  if (provider.model !== index.embeddingModel) return fail("model-mismatch");

  let queryVector: number[];
  try {
    const vectors = await provider.embedder.embedTexts([asked]);
    const { dimensions } = validateEmbeddingVectors(vectors, 1);
    if (dimensions !== index.embeddingDimensions) {
      throw new EmbeddingValidationError("Query vector dimensions do not match the index");
    }
    queryVector = vectors[0]!;
  } catch (error) {
    logFailure("embed", error);
    if (error instanceof EmbeddingValidationError) return fail("invalid-embeddings");
    if (error instanceof EmbeddingProviderError && error.code === "not_configured") return fail("not-configured");
    return fail("provider-failed");
  }

  const resultLimit = clampRetrievalLimit(limit);
  const voyage = isVoyageEmbeddingModel(index.embeddingModel);
  let raw: unknown;
  try {
    raw = await deps.searcher.search({
      playgroundId: access.project.id,
      queryVector,
      limit: resultLimit,
      manifest: index.files,
      indexName: vectorIndexForModel(index.embeddingModel),
      collection: chunkCollectionForModel(index.embeddingModel),
      ...(voyage ? { embeddingModel: index.embeddingModel } : {}),
    });
  } catch (error) {
    logFailure("search", error);
    return fail("search-failed");
  }

  let hits: ParsedHit[];
  try {
    hits = parseVectorSearchHits(raw);
  } catch (error) {
    logFailure("parse", error);
    return fail("search-failed");
  }

  const allowed = new Set(index.files.map((file) => manifestKey(file.path, file.runId)));
  const seen = new Set<string>();
  const matches = hits
    .filter((hit) => allowed.has(manifestKey(hit.path, hit.runId)))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.chunkIndex - b.chunkIndex)
    .filter((hit) => {
      const key = `${hit.path}\u0000${hit.chunkIndex}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, resultLimit)
    .map(({ path, content, startLine, endLine, score }) => ({ path, content, startLine, endLine, score }));

  return { status: "ok", matches, model: index.embeddingModel, dimensions: index.embeddingDimensions };
}

function logFailure(stage: string, error: unknown): void {
  const kind = error instanceof Error ? error.name : "UnknownError";
  console.error(`RAG retrieval failed during ${stage}: ${kind}`);
}
