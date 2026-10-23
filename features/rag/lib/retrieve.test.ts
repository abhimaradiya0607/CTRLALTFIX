import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";
import type { EmbeddingProvider } from "./embed-chunks.ts";
import type { StoredIndex } from "./index-project.ts";
import { buildChunkVectorSearchPipeline, vectorSearchBounds } from "./prisma-index-store.ts";
import {
  DEFAULT_RETRIEVAL_LIMIT,
  MAX_RETRIEVAL_LIMIT,
  retrieveProjectContext,
  type RetrieveDeps,
  type VectorSearchQuery,
} from "./retrieve.ts";

const PROJECT = { id: "project-1", userId: "user-1" };

const index: StoredIndex = {
  version: 2,
  embeddingModel: "embed-model",
  embeddingDimensions: 3,
  files: [
    { path: "src/a.ts", contentHash: "ha", runId: "run-current" },
    { path: "src/b.ts", contentHash: "hb", runId: "run-current" },
  ],
};

function hit(overrides: Record<string, unknown> = {}) {
  return {
    path: "src/a.ts",
    runId: "run-current",
    content: "const a = 1;\n",
    startLine: 1,
    endLine: 1,
    chunkIndex: 0,
    score: 0.9,
    ...overrides,
  };
}

function embedderFor(options: { fail?: boolean; vector?: number[]; seen?: string[] } = {}): EmbeddingProvider {
  return {
    async embedTexts(texts) {
      options.seen?.push(...texts);
      if (options.fail) throw new Error("provider down");
      const vector = options.vector ?? [0.1, 0.2, 0.3];
      return texts.map(() => [...vector]);
    },
  };
}

function setup(options: {
  access?: Awaited<ReturnType<RetrieveDeps["getOwnedProject"]>>;
  index?: StoredIndex | null;
  loadThrows?: boolean;
  embedder?: EmbeddingProvider;
  model?: string;
  configureThrows?: boolean;
  search?: (input: VectorSearchQuery) => Promise<unknown>;
  seen?: string[];
} = {}) {
  const searches: VectorSearchQuery[] = [];
  const deps: RetrieveDeps = {
    async getOwnedProject() {
      return options.access ?? { decision: "allowed", project: PROJECT };
    },
    async loadIndex() {
      if (options.loadThrows) throw new Error("db down");
      return options.index === undefined ? index : options.index;
    },
    createEmbedder() {
      if (options.configureThrows) throw new Error("OLLAMA_EMBED_MODEL is not set");
      return { embedder: options.embedder ?? embedderFor({ seen: options.seen }), model: options.model ?? "embed-model" };
    },
    searcher: {
      async search(input) {
        searches.push(input);
        if (options.search) return options.search(input);
        return [];
      },
    },
  };
  return { deps, searches };
}

beforeEach(() => {
  mock.method(console, "error", () => {});
});

describe("retrieveProjectContext access and empty indexes", () => {
  it("rejects an unauthenticated caller before reading the index or embedding", async () => {
    const seen: string[] = [];
    const { deps, searches } = setup({ access: { decision: "unauthenticated" }, seen });
    const result = await retrieveProjectContext(PROJECT.id, "where is the button?", deps);
    assert.equal(result.status === "error" && result.code, "unauthenticated");
    assert.equal(seen.length, 0);
    assert.equal(searches.length, 0);
  });

  it("hides projects the user does not own", async () => {
    const { deps, searches } = setup({ access: { decision: "not-found" } });
    const result = await retrieveProjectContext("other", "question", deps);
    assert.equal(result.status === "error" && result.code, "not-found");
    assert.equal(searches.length, 0);
  });

  it("returns no matches for a missing index or an empty manifest without calling the embedder", async () => {
    for (const stored of [null, { ...index, files: [] }]) {
      const seen: string[] = [];
      const { deps, searches } = setup({ index: stored, seen });
      const result = await retrieveProjectContext(PROJECT.id, "question", deps);
      assert.equal(result.status, "ok");
      if (result.status === "ok") assert.deepEqual(result.matches, []);
      assert.equal(seen.length, 0);
      assert.equal(searches.length, 0);
    }
  });

  it("rejects an empty or oversized question", async () => {
    const { deps, searches } = setup();
    const blank = await retrieveProjectContext(PROJECT.id, "   ", deps);
    assert.equal(blank.status === "error" && blank.code, "invalid-question");
    const huge = await retrieveProjectContext(PROJECT.id, "x".repeat(4_001), deps);
    assert.equal(huge.status === "error" && huge.code, "invalid-question");
    assert.equal(searches.length, 0);
  });
});

describe("retrieveProjectContext manifest filtering", () => {
  it("keeps only chunks from the current manifest and drops stale, staged, and duplicate hits", async () => {
    const { deps } = setup({
      search: async () => [
        hit({ path: "src/b.ts", content: "current b", score: 0.5, chunkIndex: 0 }),
        hit({ path: "src/a.ts", runId: "run-old", content: "stale a", score: 0.99 }),
        hit({ path: "src/a.ts", runId: "run-staging", content: "staged a", score: 0.98 }),
        hit({ path: "src/gone.ts", runId: "run-current", content: "deleted path", score: 0.97 }),
        hit({ path: "src/a.ts", content: "current a", score: 0.8, chunkIndex: 0 }),
        hit({ path: "src/a.ts", content: "duplicate a", score: 0.7, chunkIndex: 0 }),
        hit({ path: "src/a.ts", content: "second chunk", score: 0.6, chunkIndex: 1, startLine: 2, endLine: 4 }),
      ],
    });

    const result = await retrieveProjectContext(PROJECT.id, "find a", deps);
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.deepEqual(
      result.matches.map((match) => match.content),
      ["current a", "second chunk", "current b"],
    );
    assert.deepEqual(result.matches[1], {
      path: "src/a.ts",
      content: "second chunk",
      startLine: 2,
      endLine: 4,
      score: 0.6,
    });
    assert.equal("embedding" in result.matches[0]!, false);
  });

  it("orders by score and applies the default and maximum limits", async () => {
    const rows = [0.1, 0.4, 0.2, 0.9, 0.3].map((score, chunkIndex) =>
      hit({ path: "src/a.ts", score, chunkIndex, content: `chunk ${chunkIndex}`, startLine: chunkIndex + 1, endLine: chunkIndex + 1 }),
    );
    const limited = await retrieveProjectContext(PROJECT.id, "q", setup({ search: async () => rows }).deps, 2);
    assert.equal(limited.status, "ok");
    if (limited.status === "ok") {
      assert.deepEqual(limited.matches.map((match) => match.score), [0.9, 0.4]);
    }

    const defaults = await retrieveProjectContext(
      PROJECT.id,
      "q",
      setup({ search: async () => rows }).deps,
    );
    assert.equal(defaults.status === "ok" && defaults.matches.length, Math.min(DEFAULT_RETRIEVAL_LIMIT, rows.length));

    const capped = await retrieveProjectContext(PROJECT.id, "q", setup({ search: async () => rows }).deps, 500);
    assert.equal(capped.status === "ok" && capped.matches.length <= MAX_RETRIEVAL_LIMIT, true);
  });

  it("breaks score ties by path and then chunk index", async () => {
    const result = await retrieveProjectContext(
      PROJECT.id,
      "q",
      setup({
        search: async () => [
          hit({ path: "src/b.ts", score: 0.5, chunkIndex: 0, content: "b0" }),
          hit({ path: "src/a.ts", score: 0.5, chunkIndex: 1, content: "a1", startLine: 2, endLine: 2 }),
          hit({ path: "src/a.ts", score: 0.5, chunkIndex: 0, content: "a0" }),
        ],
      }).deps,
    );
    assert.equal(result.status, "ok");
    if (result.status === "ok") {
      assert.deepEqual(result.matches.map((match) => match.content), ["a0", "a1", "b0"]);
    }
  });

  it("passes the question, manifest, and clamped limit to the searcher and not a client vector", async () => {
    const { deps, searches } = setup({ search: async () => [] });
    await retrieveProjectContext(PROJECT.id, "  where is boot?  ", deps, 2.8);
    assert.equal(searches.length, 1);
    assert.deepEqual(searches[0]!.manifest.map((file) => [file.path, file.runId]), [
      ["src/a.ts", "run-current"],
      ["src/b.ts", "run-current"],
    ]);
    assert.equal(searches[0]!.limit, 2);
    assert.deepEqual(searches[0]!.queryVector, [0.1, 0.2, 0.3]);
    assert.equal(searches[0]!.playgroundId, PROJECT.id);
  });
});

describe("retrieveProjectContext failures", () => {
  it("reports a read failure", async () => {
    const result = await retrieveProjectContext(PROJECT.id, "q", setup({ loadThrows: true }).deps);
    assert.equal(result.status === "error" && result.code, "storage-failed");
  });

  it("reports a missing provider configuration", async () => {
    const result = await retrieveProjectContext(PROJECT.id, "q", setup({ configureThrows: true }).deps);
    assert.equal(result.status === "error" && result.code, "not-configured");
  });

  it("refuses to search when the configured model differs from the indexed model", async () => {
    const { deps, searches } = setup({ model: "other-model" });
    const result = await retrieveProjectContext(PROJECT.id, "q", deps);
    assert.equal(result.status === "error" && result.code, "model-mismatch");
    assert.equal(searches.length, 0);
  });

  it("propagates an embedding provider failure", async () => {
    const { deps, searches } = setup({ embedder: embedderFor({ fail: true }) });
    const result = await retrieveProjectContext(PROJECT.id, "q", deps);
    assert.equal(result.status === "error" && result.code, "provider-failed");
    assert.equal(searches.length, 0);
  });

  it("rejects an empty, non-finite, or wrong-sized query vector", async () => {
    for (const vector of [[], [Number.NaN, 1, 2], [1, 2], [1, 2, Number.POSITIVE_INFINITY]]) {
      const { deps, searches } = setup({ embedder: embedderFor({ vector }) });
      const result = await retrieveProjectContext(PROJECT.id, "q", deps);
      assert.equal(result.status === "error" && result.code, "invalid-embeddings");
      assert.equal(searches.length, 0);
    }
  });

  it("fails when vector search throws", async () => {
    const result = await retrieveProjectContext(
      PROJECT.id,
      "q",
      setup({
        search: async () => {
          throw new Error("index rag_chunk_vector not found");
        },
      }).deps,
    );
    assert.equal(result.status === "error" && result.code, "search-failed");
  });

  it("fails on a malformed vector-search payload instead of returning partial hits", async () => {
    const payloads: unknown[] = [
      { results: [] },
      [hit({ path: 12 })],
      [hit({ score: Number.NaN })],
      [hit({ score: Number.POSITIVE_INFINITY })],
      [hit({ startLine: 5, endLine: 2 })],
      [hit({ content: null })],
    ];
    for (const payload of payloads) {
      const result = await retrieveProjectContext(PROJECT.id, "q", setup({ search: async () => payload }).deps);
      assert.equal(result.status === "error" && result.code, "search-failed");
    }
  });
});

describe("buildChunkVectorSearchPipeline", () => {
  it("filters by the manifest path and runId pairs and bounds the candidate window", () => {
    const pipeline = buildChunkVectorSearchPipeline({
      playgroundId: PROJECT.id,
      queryVector: [1, 2, 3],
      resultLimit: 5,
      manifest: index.files,
    });
    const search = pipeline[0]?.$vectorSearch as {
      index: string;
      limit: number;
      numCandidates: number;
      filter: { $and: [{ playgroundId: { $eq: string } }, { $or: { $and: { path: { $eq: string }; runId: { $eq: string } }[] }[] }] };
    };
    assert.equal(search.index, "rag_chunk_vector");
    assert.equal(search.limit, vectorSearchBounds(5).limit);
    assert.ok(search.numCandidates >= search.limit);
    assert.ok(search.numCandidates <= 200);
    assert.equal(search.filter.$and[0]?.playgroundId.$eq, PROJECT.id);
    assert.deepEqual(
      search.filter.$and[1]?.$or.map((clause) => [clause.$and[0]?.path.$eq, clause.$and[1]?.runId.$eq]),
      [
        ["src/a.ts", "run-current"],
        ["src/b.ts", "run-current"],
      ],
    );
    assert.equal(JSON.stringify(pipeline).includes("run-old"), false);
  });

  it("uses the voyage index and model filter only for a voyage model", () => {
    const pipeline = buildChunkVectorSearchPipeline({
      playgroundId: PROJECT.id,
      queryVector: [1, 2, 3],
      resultLimit: 5,
      manifest: index.files,
      indexName: "rag_chunk_vector_voyage",
      embeddingModel: "voyage-code-4",
    });
    const search = pipeline[0]?.$vectorSearch as {
      index: string;
      filter: { $and: { model?: { $eq: string } }[] };
    };
    assert.equal(search.index, "rag_chunk_vector_voyage");
    assert.equal(search.filter.$and.some((clause) => clause.model?.$eq === "voyage-code-4"), true);
  });
});

describe("retrieval index selection", () => {
  it("searches the ollama index for an ollama project and the voyage index for a voyage project", async () => {
    const ollama = setup();
    await retrieveProjectContext(PROJECT.id, "where is the button?", ollama.deps);
    assert.equal(ollama.searches[0]?.indexName, "rag_chunk_vector");
    assert.equal(ollama.searches[0]?.collection, "ollama");
    assert.equal(ollama.searches[0]?.embeddingModel, undefined);

    const voyage = setup({
      index: { ...index, embeddingModel: "voyage-code-4", embeddingDimensions: 1024 },
      model: "voyage-code-4",
      embedder: embedderFor({ vector: Array.from({ length: 1024 }, () => 0.01) }),
    });
    await retrieveProjectContext(PROJECT.id, "where is the button?", voyage.deps);
    assert.equal(voyage.searches[0]?.indexName, "rag_chunk_vector_voyage");
    assert.equal(voyage.searches[0]?.collection, "voyage");
    assert.equal(voyage.searches[0]?.embeddingModel, "voyage-code-4");
  });
});
