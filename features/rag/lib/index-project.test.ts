import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";
import type { TemplateFolder } from "../../playground/types/index.ts";
import type { ChunkEmbeddingRecord, EmbeddingProvider } from "./embed-chunks.ts";
import type { ChunkCollection } from "./embedding-target.ts";
import {
  indexProject,
  rollbackProjectIndex,
  type ChunkRef,
  type IndexProjectDeps,
  type IndexStore,
  type ManifestFile,
  type StoredIndex,
} from "./index-project.ts";

const PROJECT = { id: "project-1", userId: "user-1" };
const PROBE = "dimension probe";
let runCounter = 0;

// ---------- in-memory fakes (no network, no database) ----------

interface FakeChunk extends ChunkRef {
  playgroundId: string;
  chunkIndex: number;
  model: string;
  collection: ChunkCollection;
}

class FakeStore implements IndexStore {
  index: (StoredIndex & { playgroundId: string }) | null = null;
  chunks: FakeChunk[] = [];
  nextId = 1;
  fail: Partial<
    Record<"load" | "loadAfterCommit" | "insert" | "insertAfterPartial" | "commit" | "commitAfterApply" | "cleanup" | "discard", boolean>
  > = {};
  commitConflict = false;
  /** Runs inside insertChunks after the chunks are staged; lets a test interleave another run. */
  afterStage?: () => Promise<void>;
  /** Runs at the start of listChunkRefs; lets a test add chunks a concurrent run staged during cleanup. */
  beforeList?: () => void;
  commitApplied = false;
  writes = { insert: 0, commit: 0, deleteChunks: 0 };

  async loadIndex(playgroundId: string) {
    if (this.fail.load) throw new Error("db read failed");
    if (this.fail.loadAfterCommit && this.commitApplied) throw new Error("db read failed");
    return this.index?.playgroundId === playgroundId ? structuredClone(this.index) : null;
  }

  async insertChunks(input: {
    playgroundId: string;
    runId: string;
    baseVersion: number;
    records: ChunkEmbeddingRecord[];
    collection?: ChunkCollection;
  }) {
    this.writes.insert += 1;
    if (this.fail.insert) throw new Error("db write failed");
    const collection = input.collection ?? "ollama";
    input.records.forEach((record, position) => {
      // Mirrors @@unique([playgroundId, runId, path, chunkIndex]) inside one collection.
      const duplicate = this.chunks.some(
        (c) =>
          c.collection === collection &&
          c.playgroundId === input.playgroundId &&
          c.runId === input.runId &&
          c.path === record.path &&
          c.chunkIndex === record.chunkIndex,
      );
      if (duplicate) throw new Error("unique constraint violated");
      this.chunks.push({
        id: `chunk-${this.nextId++}`,
        playgroundId: input.playgroundId,
        runId: input.runId,
        path: record.path,
        chunkIndex: record.chunkIndex,
        model: record.model,
        collection,
        baseVersion: input.baseVersion,
      });
      if (this.fail.insertAfterPartial && position === 0) throw new Error("db write failed midway");
    });
    await this.afterStage?.();
  }

  async commitIndex(input: {
    playgroundId: string;
    expectedVersion: number | null;
    embedding: { model: string; dimensions: number };
    files: ManifestFile[];
    previous?: { model: string; dimensions: number; files: ManifestFile[] } | null;
  }) {
    this.writes.commit += 1;
    if (this.fail.commit) throw new Error("db commit failed");
    if (this.commitConflict) return false;
    const currentVersion = this.index?.version ?? null;
    if (currentVersion !== input.expectedVersion) return false;
    const keptPrevious = {
      previousEmbeddingModel: this.index?.previousEmbeddingModel ?? null,
      previousEmbeddingDimensions: this.index?.previousEmbeddingDimensions ?? null,
      previousFiles: this.index?.previousFiles ?? [],
    };
    const previous =
      input.previous === undefined
        ? keptPrevious
        : input.previous === null
          ? { previousEmbeddingModel: null, previousEmbeddingDimensions: null, previousFiles: [] }
          : {
              previousEmbeddingModel: input.previous.model,
              previousEmbeddingDimensions: input.previous.dimensions,
              previousFiles: structuredClone(input.previous.files),
            };
    this.index = {
      playgroundId: input.playgroundId,
      version: (currentVersion ?? 0) + 1,
      embeddingModel: input.embedding.model,
      embeddingDimensions: input.embedding.dimensions,
      files: structuredClone(input.files),
      ...previous,
    };
    this.commitApplied = true;
    // Simulates a network error after the server applied the write.
    if (this.fail.commitAfterApply) throw new Error("connection lost after commit");
    return true;
  }

  async rollbackIndex(input: {
    playgroundId: string;
    expectedVersion: number;
    embedding: { model: string; dimensions: number };
    files: ManifestFile[];
  }) {
    if (this.commitConflict) return false;
    if (this.index?.playgroundId !== input.playgroundId) return false;
    if (this.index.version !== input.expectedVersion) return false;
    this.index = {
      ...this.index,
      version: this.index.version + 1,
      embeddingModel: input.embedding.model,
      embeddingDimensions: input.embedding.dimensions,
      files: structuredClone(input.files),
      previousEmbeddingModel: null,
      previousEmbeddingDimensions: null,
      previousFiles: [],
    };
    return true;
  }

  async listChunkRefs(playgroundId: string, collection: ChunkCollection = "ollama") {
    this.beforeList?.();
    if (this.fail.cleanup) throw new Error("db cleanup failed");
    return this.chunks
      .filter((c) => c.playgroundId === playgroundId && (c.collection ?? "ollama") === collection)
      .map(({ id, path, runId, baseVersion }) => ({ id, path, runId, baseVersion }));
  }

  async deleteChunks(ids: string[]) {
    this.writes.deleteChunks += 1;
    this.chunks = this.chunks.filter((c) => !ids.includes(c.id));
  }

  async deleteRunChunks(playgroundId: string, runId: string, collection: ChunkCollection = "ollama") {
    if (this.fail.discard) throw new Error("db discard failed");
    this.chunks = this.chunks.filter(
      (c) => !(c.playgroundId === playgroundId && c.runId === runId && c.collection === collection),
    );
  }

  /** Every manifest entry must have its chunks present (no dangling references). */
  assertNoDanglingManifest(expectedChunksPerFile = 1) {
    for (const entry of this.index?.files ?? []) {
      const found = this.chunks.filter((c) => c.path === entry.path && c.runId === entry.runId).length;
      assert.equal(found >= expectedChunksPerFile, true, `manifest entry ${entry.path} has no chunks`);
    }
  }

  /** What a reader would see: only chunks the manifest points to. */
  visibleChunks(): FakeChunk[] {
    const manifest = new Set(this.index?.files.map((f) => `${f.path}|${f.runId}`));
    return this.chunks.filter((c) => manifest.has(`${c.path}|${c.runId}`));
  }

  snapshot() {
    return structuredClone({ index: this.index, chunks: this.chunks });
  }
}

function makeEmbedder(options: { dimensions?: number; failAfterProbe?: boolean; badVector?: number[] } = {}) {
  const calls: string[][] = [];
  const dimensions = options.dimensions ?? 3;
  const embedder: EmbeddingProvider = {
    async embedTexts(texts) {
      calls.push([...texts]);
      const isProbe = texts.length === 1 && texts[0] === PROBE;
      if (options.failAfterProbe && !isProbe) throw new Error("provider down");
      if (options.badVector && !isProbe) return texts.map(() => options.badVector!);
      return texts.map((text) => Array.from({ length: dimensions }, (_, i) => text.length + i));
    },
  };
  return { embedder, calls, contentCalls: () => calls.filter((c) => !(c.length === 1 && c[0] === PROBE)) };
}

function file(name: string, content: string) {
  const [filename, fileExtension] = name.split(".");
  return { filename: filename!, fileExtension: fileExtension!, content };
}

function treeOf(files: Record<string, string>): TemplateFolder {
  return {
    folderName: "demo",
    items: [{ folderName: "src", items: Object.entries(files).map(([name, content]) => file(name, content)) }],
  };
}

function setup(options: {
  tree?: unknown;
  store?: FakeStore;
  embedder?: ReturnType<typeof makeEmbedder>;
  model?: string;
  access?: Awaited<ReturnType<IndexProjectDeps["getOwnedProject"]>>;
  createEmbedderThrows?: boolean;
} = {}) {
  const store = options.store ?? new FakeStore();
  const embedder = options.embedder ?? makeEmbedder();
  const deps: IndexProjectDeps = {
    async getOwnedProject() {
      return options.access ?? { decision: "allowed", project: PROJECT };
    },
    async loadSavedTree() {
      return options.tree === undefined ? treeOf({ "a.ts": "const a = 1;\n", "b.ts": "const b = 2;\n" }) : options.tree;
    },
    store,
    createEmbedder() {
      if (options.createEmbedderThrows) throw new Error("not configured");
      return { embedder: embedder.embedder, model: options.model ?? "embed-model" };
    },
    newRunId: () => `run-${++runCounter}`, // unique across setups, like real UUIDs
  };
  return { deps, store, embedder };
}

beforeEach(() => {
  mock.method(console, "error", () => {});
});

// ---------- tests ----------

describe("indexProject authorization and input", () => {
  it("rejects unauthenticated requests before touching data or the provider", async () => {
    const { deps, store, embedder } = setup({ access: { decision: "unauthenticated" } });
    const result = await indexProject(PROJECT.id, deps);
    assert.deepEqual(result.status === "error" && result.code, "unauthenticated");
    assert.equal(embedder.calls.length, 0);
    assert.equal(store.writes.insert + store.writes.commit, 0);
  });

  it("returns not-found for projects the user does not own (indistinguishable from missing)", async () => {
    const { deps, store, embedder } = setup({ access: { decision: "not-found" } });
    const result = await indexProject("someone-elses-project", deps);
    assert.equal(result.status === "error" && result.code, "not-found");
    assert.equal(embedder.calls.length, 0);
    assert.equal(store.writes.commit, 0);
  });

  it("reports a missing saved tree and a malformed saved tree", async () => {
    for (const tree of [null, { not: "a tree" }, "text"]) {
      const { deps, embedder } = setup({ tree });
      const result = await indexProject(PROJECT.id, deps);
      assert.equal(result.status === "error" && result.code, "no-saved-project");
      assert.equal(embedder.calls.length, 0);
    }
  });

  it("reports an unconfigured provider without writing", async () => {
    const { deps, store } = setup({ createEmbedderThrows: true });
    const result = await indexProject(PROJECT.id, deps);
    assert.equal(result.status === "error" && result.code, "not-configured");
    assert.equal(store.writes.commit, 0);
  });

  it("reports a database read failure", async () => {
    const store = new FakeStore();
    store.fail.load = true;
    const result = await indexProject(PROJECT.id, setup({ store }).deps);
    assert.equal(result.status === "error" && result.code, "storage-failed");
  });
});

describe("indexProject indexing", () => {
  it("indexes a project for the first time and stores the resolved model and dimensions", async () => {
    const { deps, store } = setup({ model: "embed-model", embedder: makeEmbedder({ dimensions: 5 }) });
    const result = await indexProject(PROJECT.id, deps);

    assert.deepEqual(result, {
      status: "ok",
      embeddedFiles: 2,
      embeddedChunks: 2,
      skippedFiles: 0,
      deletedFiles: 0,
      model: "embed-model",
      dimensions: 5,
    });
    assert.equal(store.index?.embeddingModel, "embed-model");
    assert.equal(store.index?.embeddingDimensions, 5);
    assert.deepEqual(store.index?.files.map((f) => f.path), ["src/a.ts", "src/b.ts"]);
    assert.equal(store.visibleChunks().length, 2);
  });

  it("does not embed or write anything when nothing changed", async () => {
    const first = setup();
    await indexProject(PROJECT.id, first.deps);
    const before = first.store.snapshot();

    const second = setup({ store: first.store });
    const result = await indexProject(PROJECT.id, second.deps);

    assert.equal(result.status === "ok" && result.skippedFiles, 2);
    assert.equal(result.status === "ok" && result.embeddedFiles, 0);
    assert.deepEqual(second.embedder.contentCalls(), []);
    assert.deepEqual(first.store.snapshot(), before);
  });

  it("re-embeds only changed files and removes stale chunks for changed and deleted files", async () => {
    const first = setup({ tree: treeOf({ "a.ts": "const a = 1;\n", "b.ts": "const b = 2;\n", "c.ts": "const c = 3;\n" }) });
    await indexProject(PROJECT.id, first.deps);
    const runForC = first.store.index!.files.find((f) => f.path === "src/c.ts")!.runId;

    const second = setup({
      store: first.store,
      tree: treeOf({ "a.ts": "const a = 100;\n", "c.ts": "const c = 3;\n" }), // a changed, b deleted, c unchanged
    });
    const result = await indexProject(PROJECT.id, second.deps);

    assert.equal(result.status === "ok" && result.embeddedFiles, 1);
    assert.equal(result.status === "ok" && result.skippedFiles, 1);
    assert.equal(result.status === "ok" && result.deletedFiles, 1);
    assert.deepEqual(second.embedder.contentCalls(), [["const a = 100;\n"]]);

    const files = first.store.index!.files;
    assert.deepEqual(files.map((f) => f.path), ["src/a.ts", "src/c.ts"]);
    assert.equal(files.find((f) => f.path === "src/c.ts")!.runId, runForC); // unchanged file keeps its chunks
    // Every stored chunk is referenced: no stale or duplicate leftovers.
    assert.equal(first.store.chunks.length, first.store.visibleChunks().length);
    assert.equal(first.store.chunks.some((c) => c.path === "src/b.ts"), false);
    assert.equal(first.store.index!.version, 2);
  });

  it("rebuilds everything when the embedding model changes", async () => {
    const first = setup({ model: "model-a" });
    await indexProject(PROJECT.id, first.deps);

    const second = setup({ store: first.store, model: "model-b" });
    const result = await indexProject(PROJECT.id, second.deps);

    assert.equal(result.status === "ok" && result.embeddedFiles, 2);
    assert.equal(result.status === "ok" && result.skippedFiles, 0);
    assert.equal(first.store.index!.embeddingModel, "model-b");
    assert.equal(first.store.chunks.every((c) => c.model === "model-b"), true);
    assert.equal(first.store.chunks.length, 2);
  });

  it("rebuilds everything when the vector dimensions change", async () => {
    const first = setup({ embedder: makeEmbedder({ dimensions: 3 }) });
    await indexProject(PROJECT.id, first.deps);

    const second = setup({ store: first.store, embedder: makeEmbedder({ dimensions: 4 }) });
    const result = await indexProject(PROJECT.id, second.deps);

    assert.equal(result.status === "ok" && result.embeddedFiles, 2);
    assert.equal(first.store.index!.embeddingDimensions, 4);
    assert.equal(first.store.chunks.length, 2);
  });

  it("creates no duplicate chunks across repeated requests", async () => {
    const store = new FakeStore();
    for (let i = 0; i < 3; i += 1) {
      await indexProject(PROJECT.id, setup({ store }).deps);
    }
    assert.equal(store.chunks.length, 2);
    assert.equal(store.visibleChunks().length, 2);
    assert.equal(store.index!.version, 1);
  });
});

describe("indexProject failure handling", () => {
  async function indexedStore() {
    const ctx = setup();
    await indexProject(PROJECT.id, ctx.deps);
    return ctx.store;
  }

  const changedTree = treeOf({ "a.ts": "const a = 'changed';\n", "b.ts": "const b = 2;\n" });

  it("keeps the previous index when the provider fails", async () => {
    const store = await indexedStore();
    const before = store.snapshot();
    const result = await indexProject(
      PROJECT.id,
      setup({ store, tree: changedTree, embedder: makeEmbedder({ failAfterProbe: true }) }).deps,
    );
    assert.equal(result.status === "error" && result.code, "provider-failed");
    assert.deepEqual(store.snapshot(), before);
  });

  it("rejects invalid vectors from the provider without writing", async () => {
    for (const badVector of [[Number.NaN, 1, 2], [], [1, 2]]) {
      const store = await indexedStore();
      const before = store.snapshot();
      const result = await indexProject(
        PROJECT.id,
        setup({ store, tree: changedTree, embedder: makeEmbedder({ badVector }) }).deps,
      );
      assert.equal(result.status === "error" && result.code, "invalid-embeddings");
      assert.deepEqual(store.snapshot(), before);
    }
  });

  it("keeps the previous index and discards staging chunks when inserting chunks fails midway", async () => {
    const store = await indexedStore();
    const before = store.snapshot();
    store.fail.insertAfterPartial = true;

    const result = await indexProject(PROJECT.id, setup({ store, tree: changedTree }).deps);

    assert.equal(result.status === "error" && result.code, "storage-failed");
    assert.deepEqual(store.snapshot(), before);
    assert.equal(store.visibleChunks().length, 2);
  });

  it("keeps the previous index when the commit write fails", async () => {
    const store = await indexedStore();
    const before = store.snapshot();
    store.fail.commit = true;

    const result = await indexProject(PROJECT.id, setup({ store, tree: changedTree }).deps);

    assert.equal(result.status === "error" && result.code, "storage-failed");
    assert.deepEqual(store.snapshot(), before);
  });

  it("returns a conflict and discards its chunks when another run committed first", async () => {
    const store = await indexedStore();
    const before = store.snapshot();
    store.commitConflict = true;

    const result = await indexProject(PROJECT.id, setup({ store, tree: changedTree }).deps);

    assert.equal(result.status === "error" && result.code, "conflict");
    assert.deepEqual(store.snapshot(), before);
  });

  it("still reports success when only the post-commit cleanup fails, and the new index is live", async () => {
    const store = await indexedStore();
    store.fail.cleanup = true;

    const result = await indexProject(PROJECT.id, setup({ store, tree: changedTree }).deps);

    assert.equal(result.status, "ok");
    assert.equal(store.index!.version, 2);
    assert.equal(store.visibleChunks().length, 2); // stale chunks may remain, but are never referenced
  });

  it("never deletes chunks of a run that started from the current version, however old they are", async () => {
    const store = await indexedStore(); // committed version 1
    // Cleanup after the next commit (version 2) sees: a dead run (started from version 0 or 1)
    // and a live run that started from version 2 (i.e. after this commit).
    store.beforeList = () => {
      store.chunks.push(
        { id: "dead", playgroundId: PROJECT.id, runId: "dead-run", path: "src/y.ts", chunkIndex: 0, model: "m", baseVersion: 1 },
        { id: "live", playgroundId: PROJECT.id, runId: "live-run", path: "src/x.ts", chunkIndex: 0, model: "m", baseVersion: 2 },
      );
    };

    await indexProject(PROJECT.id, setup({ store, tree: changedTree }).deps);

    assert.equal(store.index!.version, 2);
    assert.equal(store.chunks.some((c) => c.id === "live"), true);
    assert.equal(store.chunks.some((c) => c.id === "dead"), false);
  });
});

describe("indexProject concurrent runs", () => {
  const treeB = treeOf({ "a.ts": "const a = 'from run B';\n", "b.ts": "const b = 2;\n" });
  const treeA = treeOf({ "a.ts": "const a = 'from run A';\n", "b.ts": "const b = 2;\n" });

  it("a slow run cannot overwrite a newer manifest, and cannot lose or delete the winner's chunks", async () => {
    const first = setup();
    await indexProject(PROJECT.id, first.deps); // version 1
    const store = first.store;

    // Run A reads version 1 and stages its chunks. While A is paused, run B commits version 2
    // and runs its cleanup. Then A tries to commit.
    const runA = setup({ store, tree: treeA });
    store.afterStage = async () => {
      store.afterStage = undefined;
      const runB = await indexProject(PROJECT.id, setup({ store, tree: treeB }).deps);
      assert.equal(runB.status, "ok");
    };
    const resultA = await indexProject(PROJECT.id, runA.deps);

    assert.equal(resultA.status === "error" && resultA.code, "conflict");
    assert.equal(store.index!.version, 2);
    const aEntry = store.index!.files.find((f) => f.path === "src/a.ts")!;
    const chunkOfA = store.chunks.find((c) => c.path === "src/a.ts" && c.runId === aEntry.runId);
    assert.ok(chunkOfA, "winner's chunk for src/a.ts must still exist");
    store.assertNoDanglingManifest();
    // The loser's staged chunks are gone and the store holds exactly what the manifest references.
    assert.equal(store.chunks.length, store.visibleChunks().length);
  });

  it("a long-running run (staged long ago) is dead once another run commits, and fails safely", async () => {
    const first = setup();
    await indexProject(PROJECT.id, first.deps);
    const store = first.store;

    store.afterStage = async () => {
      store.afterStage = undefined;
      // Simulate hours passing: chunk age is irrelevant, only versions matter.
      await indexProject(PROJECT.id, setup({ store, tree: treeB }).deps);
    };
    const result = await indexProject(PROJECT.id, setup({ store, tree: treeA }).deps);

    assert.equal(result.status === "error" && result.code, "conflict");
    store.assertNoDanglingManifest();
  });

  it("two first-time runs: the second commit conflicts instead of replacing the first", async () => {
    const store = new FakeStore();
    store.afterStage = async () => {
      store.afterStage = undefined;
      await indexProject(PROJECT.id, setup({ store, tree: treeB }).deps);
    };
    const result = await indexProject(PROJECT.id, setup({ store, tree: treeA }).deps);

    assert.equal(result.status === "error" && result.code, "conflict");
    assert.equal(store.index!.version, 1);
    store.assertNoDanglingManifest();
    assert.equal(store.chunks.length, store.visibleChunks().length);
  });
});

describe("indexProject ambiguous commit failures", () => {
  const changed = treeOf({ "a.ts": "const a = 'changed';\n", "b.ts": "const b = 2;\n" });

  it("treats a commit that was applied before the connection failed as success, without deleting its chunks", async () => {
    const first = setup();
    await indexProject(PROJECT.id, first.deps);
    const store = first.store;
    store.fail.commitAfterApply = true;

    const result = await indexProject(PROJECT.id, setup({ store, tree: changed }).deps);

    assert.equal(result.status, "ok");
    assert.equal(store.index!.version, 2);
    store.assertNoDanglingManifest();
    assert.equal(store.chunks.length, store.visibleChunks().length);
  });

  it("keeps staged chunks when the commit outcome cannot be determined", async () => {
    const first = setup();
    await indexProject(PROJECT.id, first.deps);
    const store = first.store;
    store.fail.commitAfterApply = true;
    store.fail.loadAfterCommit = true;

    const result = await indexProject(PROJECT.id, setup({ store, tree: changed }).deps);

    assert.equal(result.status === "error" && result.code, "storage-failed");
    // The commit actually happened. Because nothing was deleted, the manifest is not dangling.
    store.assertNoDanglingManifest();
  });
});

describe("indexProject with no eligible files and configuration changes", () => {
  const emptyTree = treeOf({});
  const onlyExcluded: TemplateFolder = {
    folderName: "demo",
    items: [{ filename: ".env", fileExtension: "", content: "SECRET=1\n" }],
  };

  it("indexes a project with no eligible files as an empty index, and a repeat is a no-op", async () => {
    const store = new FakeStore();
    const first = await indexProject(PROJECT.id, setup({ store, tree: emptyTree }).deps);
    assert.equal(first.status, "ok");
    assert.deepEqual(store.index?.files, []);
    assert.equal(store.chunks.length, 0);

    const writesBefore = { ...store.writes };
    const again = await indexProject(PROJECT.id, setup({ store, tree: emptyTree }).deps);
    assert.equal(again.status, "ok");
    assert.deepEqual(store.writes, writesBefore);
    assert.equal(store.index!.version, 1);
  });

  it("removes all chunks when every indexed file is deleted or becomes excluded", async () => {
    for (const tree of [emptyTree, onlyExcluded]) {
      const first = setup();
      await indexProject(PROJECT.id, first.deps);
      const store = first.store;
      assert.equal(store.visibleChunks().length, 2);

      const result = await indexProject(PROJECT.id, setup({ store, tree }).deps);

      assert.equal(result.status === "ok" && result.deletedFiles, 2);
      assert.deepEqual(store.index?.files, []);
      assert.equal(store.chunks.length, 0);
    }
  });

  it("records a new model on an empty project so stored config never disagrees with the manifest", async () => {
    const store = new FakeStore();
    await indexProject(PROJECT.id, setup({ store, tree: emptyTree, model: "model-a" }).deps);

    const result = await indexProject(PROJECT.id, setup({ store, tree: emptyTree, model: "model-b" }).deps);

    assert.equal(result.status, "ok");
    assert.equal(store.index!.embeddingModel, "model-b");
    assert.equal(store.index!.version, 2);
    assert.equal(store.chunks.length, 0);

    // Repeating with the same configuration changes nothing.
    await indexProject(PROJECT.id, setup({ store, tree: emptyTree, model: "model-b" }).deps);
    assert.equal(store.index!.version, 2);
  });

  it("records new dimensions on an empty project", async () => {
    const store = new FakeStore();
    await indexProject(PROJECT.id, setup({ store, tree: emptyTree, embedder: makeEmbedder({ dimensions: 3 }) }).deps);
    await indexProject(PROJECT.id, setup({ store, tree: emptyTree, embedder: makeEmbedder({ dimensions: 4 }) }).deps);
    assert.equal(store.index!.embeddingDimensions, 4);
    assert.equal(store.index!.version, 2);
  });

  it("empties the index and adopts the new model when files vanish and the model changes together", async () => {
    const first = setup({ model: "model-a" });
    await indexProject(PROJECT.id, first.deps);
    const store = first.store;

    await indexProject(PROJECT.id, setup({ store, tree: emptyTree, model: "model-b" }).deps);

    assert.deepEqual(store.index?.files, []);
    assert.equal(store.index!.embeddingModel, "model-b");
    assert.equal(store.chunks.length, 0);
  });

  it("then indexes new files under the new model after an empty period", async () => {
    const first = setup({ model: "model-a" });
    await indexProject(PROJECT.id, first.deps);
    const store = first.store;
    await indexProject(PROJECT.id, setup({ store, tree: emptyTree, model: "model-b" }).deps);

    await indexProject(PROJECT.id, setup({ store, model: "model-b" }).deps);

    assert.equal(store.visibleChunks().length, 2);
    assert.equal(store.chunks.every((c) => c.model === "model-b"), true);
    store.assertNoDanglingManifest();
  });
});

describe("voyage publication keeps the Ollama index", () => {
  it("publishes Voyage without deleting Ollama chunks and can roll back", async () => {
    const first = setup({ model: "embed-model" });
    await indexProject(PROJECT.id, first.deps);
    const store = first.store;
    const ollamaFiles = structuredClone(store.index!.files);
    assert.equal(store.chunks.every((chunk) => chunk.collection === "ollama"), true);

    const published = await indexProject(PROJECT.id, setup({ store, model: "voyage-code-4" }).deps);
    assert.equal(published.status, "ok");
    assert.equal(store.index!.embeddingModel, "voyage-code-4");
    assert.equal(store.index!.previousEmbeddingModel, "embed-model");
    assert.deepEqual(store.index!.previousFiles, ollamaFiles);
    assert.equal(store.chunks.some((chunk) => chunk.model === "embed-model" && chunk.collection === "ollama"), true);
    assert.equal(store.chunks.some((chunk) => chunk.model === "voyage-code-4" && chunk.collection === "voyage"), true);
    assert.equal(store.visibleChunks().every((chunk) => chunk.collection === "voyage"), true);

    const again = await indexProject(PROJECT.id, setup({ store, model: "embed-model" }).deps);
    assert.equal(again.status === "error" && again.code, "rollback-required");
    assert.equal(store.index!.embeddingModel, "voyage-code-4");

    const restored = await rollbackProjectIndex(PROJECT.id, { getOwnedProject: first.deps.getOwnedProject, store });
    assert.equal(restored.status === "ok" && restored.model, "embed-model");
    assert.deepEqual(store.index!.files, ollamaFiles);
    assert.equal(store.index!.previousEmbeddingModel ?? null, null);
    assert.equal(store.chunks.some((chunk) => chunk.collection === "ollama"), true);
    assert.equal(store.chunks.some((chunk) => chunk.collection === "voyage"), true);
    assert.equal(store.visibleChunks().every((chunk) => chunk.collection === "ollama"), true);
  });

  it("leaves the Ollama manifest in place when the Voyage commit loses a version race", async () => {
    const first = setup({ model: "embed-model" });
    await indexProject(PROJECT.id, first.deps);
    const store = first.store;
    const before = store.snapshot();
    store.commitConflict = true;

    const result = await indexProject(PROJECT.id, setup({ store, model: "voyage-code-4" }).deps);
    assert.equal(result.status === "error" && result.code, "conflict");
    assert.equal(store.index!.embeddingModel, "embed-model");
    assert.deepEqual(store.index!.files, before.index!.files);
    assert.equal(store.index!.previousEmbeddingModel ?? null, null);
    assert.equal(store.chunks.some((chunk) => chunk.collection === "voyage"), false);
    assert.equal(store.chunks.filter((chunk) => chunk.collection === "ollama").length, before.chunks.length);
  });

  it("does not roll back a project that has no saved previous manifest", async () => {
    const { deps, store } = setup();
    await indexProject(PROJECT.id, deps);
    const result = await rollbackProjectIndex(PROJECT.id, { getOwnedProject: deps.getOwnedProject, store });
    assert.equal(result.status === "error" && result.code, "nothing-to-roll-back");
    assert.equal(store.index!.embeddingModel, "embed-model");
  });
});
