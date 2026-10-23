import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmbeddingProviderError, EmbeddingValidationError } from "./embed-chunks.ts";
import {
  createOllamaEmbedder,
  DEFAULT_OLLAMA_EMBED_BATCH_SIZE,
  resolveOllamaBaseUrl,
} from "./ollama-embedder.ts";

function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response>): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init ?? {})) as typeof fetch;
}

describe("resolveOllamaBaseUrl", () => {
  it("requires explicit base URL in production", () => {
    assert.throws(
      () => resolveOllamaBaseUrl({ NODE_ENV: "production" }),
      (error: Error) => error instanceof EmbeddingProviderError,
    );
  });

  it("uses OLLAMA_BASE_URL when set", () => {
    assert.equal(
      resolveOllamaBaseUrl({ OLLAMA_BASE_URL: "https://ollama.example/" }),
      "https://ollama.example",
    );
  });
});

describe("createOllamaEmbedder", () => {
  it("posts to /api/embed with model and batched input", async () => {
    const requests: { url: string; body: unknown }[] = [];
    const embedder = createOllamaEmbedder({
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3-embedding:0.6b",
      maxBatchSize: 2,
      fetch: mockFetch(async (url, init) => {
        requests.push({ url, body: JSON.parse(String(init.body)) });
        const body = JSON.parse(String(init.body)) as { input: string[] };
        return new Response(
          JSON.stringify({
            model: "qwen3-embedding:0.6b",
            embeddings: body.input.map((text, index) => [index + 1, text.length, 0.5]),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    });

    const vectors = await embedder.embedTexts(["a", "bb", "ccc", "dddd"]);
    assert.equal(vectors.length, 4);
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.url, "http://127.0.0.1:11434/api/embed");
    assert.deepEqual((requests[0]?.body as { input: string[] }).input, ["a", "bb"]);
    assert.deepEqual((requests[1]?.body as { input: string[] }).input, ["ccc", "dddd"]);
    assert.deepEqual(vectors[0], [1, 1, 0.5]);
    assert.deepEqual(vectors[1], [2, 2, 0.5]);
    assert.deepEqual(vectors[2], [1, 3, 0.5]);
    assert.deepEqual(vectors[3], [2, 4, 0.5]);
  });

  it("preserves vector order across batches", async () => {
    let batch = 0;
    const embedder = createOllamaEmbedder({
      baseUrl: "http://127.0.0.1:11434",
      model: "embed",
      maxBatchSize: 1,
      fetch: mockFetch(async (_url, init) => {
        batch += 1;
        const body = JSON.parse(String(init.body)) as { input: string[] };
        return new Response(
          JSON.stringify({ embeddings: [[batch, body.input[0]?.length ?? 0]] }),
          { status: 200 },
        );
      }),
    });

    const vectors = await embedder.embedTexts(["one", "two"]);
    assert.deepEqual(vectors, [
      [1, 3],
      [2, 3],
    ]);
  });

  it("surfaces HTTP errors", async () => {
    const embedder = createOllamaEmbedder({
      baseUrl: "http://127.0.0.1:11434",
      model: "embed",
      fetch: mockFetch(async () => new Response("fail", { status: 500 })),
    });

    await assert.rejects(
      () => embedder.embedTexts(["x"]),
      (error: Error) =>
        error instanceof EmbeddingProviderError && error.message.includes("status 500"),
    );
  });

  it("surfaces timeout as provider error", async () => {
    const embedder = createOllamaEmbedder({
      baseUrl: "http://127.0.0.1:11434",
      model: "embed",
      timeoutMs: 5,
      fetch: mockFetch(async (_url, init) => {
        await new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (signal?.aborted) {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            return;
          }
          signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
        return new Response(JSON.stringify({ embeddings: [[1]] }), { status: 200 });
      }),
    });

    await assert.rejects(
      () => embedder.embedTexts(["slow"]),
      (error: Error) =>
        error instanceof EmbeddingProviderError && error.message.includes("timed out"),
    );
  });

  it("rejects malformed JSON responses", async () => {
    const embedder = createOllamaEmbedder({
      baseUrl: "http://127.0.0.1:11434",
      model: "embed",
      fetch: mockFetch(async () => new Response("not-json", { status: 200 })),
    });

    await assert.rejects(
      () => embedder.embedTexts(["x"]),
      (error: Error) => error instanceof EmbeddingProviderError,
    );
  });

  it("rejects responses with wrong vector count", async () => {
    const embedder = createOllamaEmbedder({
      baseUrl: "http://127.0.0.1:11434",
      model: "embed",
      fetch: mockFetch(async () =>
        new Response(JSON.stringify({ embeddings: [[1, 2]] }), { status: 200 }),
      ),
    });

    await assert.rejects(
      () => embedder.embedTexts(["a", "b"]),
      (error: Error) => error instanceof EmbeddingValidationError,
    );
  });

  it("uses a conservative default batch size", () => {
    assert.equal(DEFAULT_OLLAMA_EMBED_BATCH_SIZE, 32);
  });
});
