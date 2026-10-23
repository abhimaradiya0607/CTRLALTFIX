import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHUNK_LIMITS } from "./chunk-source.ts";
import {
  embedChangedFiles,
  EmbeddingProviderError,
  EmbeddingValidationError,
  validateEmbeddingVectors,
  type EmbeddingProvider,
} from "./embed-chunks.ts";
import type { EmbeddingIndexConfig, IndexPlanEntry } from "./index-plan.ts";

const embedding: EmbeddingIndexConfig = {
  model: "test-embed-model",
  dimensions: 3,
};

function fakeVector(seed: string, dimensions: number): number[] {
  const out: number[] = [];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  for (let d = 0; d < dimensions; d += 1) {
    out.push(((hash + d * 17) % 1000) / 1000);
  }
  return out;
}

function createFakeEmbedder(options?: {
  dimensions?: number;
  onCall?: (texts: readonly string[]) => void;
  impl?: (texts: readonly string[]) => number[][];
}): EmbeddingProvider {
  const dimensions = options?.dimensions ?? embedding.dimensions;
  return {
    async embedTexts(texts) {
      options?.onCall?.(texts);
      if (options?.impl) {
        return options.impl(texts);
      }
      return texts.map((text) => fakeVector(text, dimensions));
    },
  };
}

function entry(path: string, content: string, contentHash = `hash-${path}`): IndexPlanEntry {
  return { path, content, contentHash };
}

describe("validateEmbeddingVectors", () => {
  it("rejects vector count mismatch", () => {
    assert.throws(
      () => validateEmbeddingVectors([[1, 2, 3]], 2),
      (error: Error) => error instanceof EmbeddingValidationError,
    );
  });

  it("rejects empty vectors", () => {
    assert.throws(
      () => validateEmbeddingVectors([[]], 1),
      (error: Error) => error instanceof EmbeddingValidationError,
    );
  });

  it("rejects inconsistent dimensions", () => {
    assert.throws(
      () => validateEmbeddingVectors([[1, 2], [3]], 2),
      (error: Error) => error instanceof EmbeddingValidationError,
    );
  });

  it("rejects non-finite values", () => {
    assert.throws(
      () => validateEmbeddingVectors([[Number.NaN, 1, 2]], 1),
      (error: Error) => error instanceof EmbeddingValidationError,
    );
    assert.throws(
      () => validateEmbeddingVectors([[Number.POSITIVE_INFINITY, 1, 2]], 1),
      (error: Error) => error instanceof EmbeddingValidationError,
    );
    assert.throws(
      () => validateEmbeddingVectors([[Number.NEGATIVE_INFINITY, 1, 2]], 1),
      (error: Error) => error instanceof EmbeddingValidationError,
    );
    assert.throws(
      () => validateEmbeddingVectors([["1" as unknown as number, 2, 3]], 1),
      (error: Error) => error instanceof EmbeddingValidationError,
    );
  });
});

describe("embedChangedFiles", () => {
  it("returns empty result without calling the embedder when there are no chunks", async () => {
    let calls = 0;
    const records = await embedChangedFiles({
      toEmbed: [],
      embedding,
      embedder: {
        async embedTexts(texts) {
          calls += 1;
          assert.equal(texts.length, 0);
          return [];
        },
      },
    });
    assert.deepEqual(records, []);
    assert.equal(calls, 0);
  });

  it("maps one file to multiple chunk records in order", async () => {
    const lines = Array.from({ length: CHUNK_LIMITS.maxLines + 5 }, (_, i) => `line ${i + 1}`).join("\n");
    const records = await embedChangedFiles({
      toEmbed: [entry("src/big.ts", lines, "hash-big")],
      embedding,
      embedder: createFakeEmbedder(),
    });

    assert.ok(records.length >= 2);
    assert.equal(records[0]?.path, "src/big.ts");
    assert.equal(records[0]?.chunkIndex, 0);
    assert.equal(records[0]?.fileHash, "hash-big");
    assert.equal(records[1]?.chunkIndex, 1);
    assert.deepEqual(records.map((r) => r.chunkIndex), records.map((_, i) => i));
  });

  it("keeps deterministic ordering across multiple files", async () => {
    const records = await embedChangedFiles({
      toEmbed: [
        entry("z/last.ts", "z\n"),
        entry("a/first.ts", "a\n"),
      ],
      embedding,
      embedder: createFakeEmbedder(),
    });

    assert.deepEqual(
      records.map((r) => `${r.path}#${r.chunkIndex}`),
      ["a/first.ts#0", "z/last.ts#0"],
    );
  });

  it("calls the embedder only for supplied toEmbed content", async () => {
    const seen: string[] = [];
    await embedChangedFiles({
      toEmbed: [entry("only.ts", "export const x = 1;\n")],
      embedding,
      embedder: createFakeEmbedder({
        onCall(texts) {
          seen.push(...texts);
        },
      }),
    });
    assert.deepEqual(seen, ["export const x = 1;\n"]);
  });

  it("propagates provider failures without returning partial records", async () => {
    await assert.rejects(
      () =>
        embedChangedFiles({
          toEmbed: [entry("fail.ts", "x\n")],
          embedding,
          embedder: {
            async embedTexts() {
              throw new Error("provider down");
            },
          },
        }),
      (error: Error) => error instanceof EmbeddingProviderError,
    );
  });

  it("fails when configured dimensions do not match response", async () => {
    await assert.rejects(
      () =>
        embedChangedFiles({
          toEmbed: [entry("dim.ts", "x\n")],
          embedding: { model: "m", dimensions: 4 },
          embedder: createFakeEmbedder({ dimensions: 3 }),
        }),
      (error: Error) => error instanceof EmbeddingValidationError,
    );
  });

  it("sets model and dimensions metadata from config and validated vectors", async () => {
    const records = await embedChangedFiles({
      toEmbed: [entry("meta.ts", "hello\n")],
      embedding,
      embedder: createFakeEmbedder(),
    });
    assert.equal(records[0]?.model, embedding.model);
    assert.equal(records[0]?.dimensions, embedding.dimensions);
    assert.equal(records[0]?.embedding.length, embedding.dimensions);
  });

  it("does not mutate plan entries or chunk content", async () => {
    const planEntry = entry("mut.ts", "const a = 1;\n", "hash-mut");
    const before = structuredClone(planEntry);
    const records = await embedChangedFiles({
      toEmbed: [planEntry],
      embedding,
      embedder: createFakeEmbedder(),
    });
    assert.deepEqual(planEntry, before);
    assert.equal(records[0]?.content, "const a = 1;\n");
  });
});
