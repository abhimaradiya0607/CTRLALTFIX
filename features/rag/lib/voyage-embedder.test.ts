import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmbeddingProviderError, EmbeddingValidationError } from "./embed-chunks.ts";
import { createVoyageEmbedder } from "./voyage-embedder.ts";

const KEY = "test-voyage-key-do-not-leak";
const SOURCE = "const secret = 'project-source';";

function mockFetch(
  handler: (url: string, init: RequestInit) => Promise<Response> | Response,
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init ?? {})) as typeof fetch;
}

function embeddingBody(vectors: number[][], order: number[] = vectors.map((_, index) => index)): string {
  return JSON.stringify({
    object: "list",
    data: order.map((index) => ({
      object: "embedding",
      index,
      embedding: vectors[index],
    })),
    model: "voyage-code-4",
    usage: { total_tokens: 3 },
  });
}

function assertSafe(error: unknown, code: string): asserts error is EmbeddingProviderError {
  assert.ok(error instanceof EmbeddingProviderError);
  assert.equal(error.code, code);
  const rendered = `${error.message}\n${String(error)}`;
  assert.equal(rendered.includes(KEY), false);
  assert.equal(rendered.includes(SOURCE), false);
}

describe("createVoyageEmbedder", () => {
  it("does not call the network when the API key is missing", async () => {
    let calls = 0;
    const embedder = createVoyageEmbedder({
      inputType: "document",
      env: {},
      fetch: mockFetch(() => {
        calls += 1;
        return new Response("{}", { status: 200 });
      }),
    });

    await assert.rejects(() => embedder.embedTexts([SOURCE]), (error: unknown) => {
      assertSafe(error, "not_configured");
      return true;
    });
    assert.equal(calls, 0);
  });

  it("returns one vector per input in request order when the response indices are reversed", async () => {
    const requests: {
      url: string;
      headers: Headers;
      body: { input: string[]; model: string; input_type: string; output_dimension: number; output_dtype: string };
    }[] = [];
    const vector = (marker: number) => Array.from({ length: 256 }, (_, index) => (index === 0 ? marker : 0));
    const embedder = createVoyageEmbedder({
      inputType: "document",
      outputDimension: 256,
      maxBatchSize: 2,
      env: { VOYAGE_API_KEY: KEY },
      fetch: mockFetch(async (url, init) => {
        const body = JSON.parse(String(init.body)) as {
          input: string[];
          model: string;
          input_type: string;
          output_dimension: number;
          output_dtype: string;
        };
        requests.push({ url, headers: new Headers(init.headers), body });
        const vectors = body.input.map((_, index) => vector(index + 1));
        return new Response(embeddingBody(vectors, [...vectors.keys()].reverse()), { status: 200 });
      }),
    });

    const vectors = await embedder.embedTexts(["a", "bb", "ccc"]);
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.url, "https://api.voyageai.com/v1/embeddings");
    assert.equal(requests[0]?.url.includes(KEY), false);
    assert.equal(requests[0]?.headers.get("authorization"), `Bearer ${KEY}`);
    assert.deepEqual(requests[0]?.body.input, ["a", "bb"]);
    assert.equal(requests[0]?.body.model, "voyage-code-4");
    assert.equal(requests[0]?.body.input_type, "document");
    assert.equal(requests[0]?.body.output_dimension, 256);
    assert.equal(requests[0]?.body.output_dtype, "float");
    assert.equal(JSON.stringify(requests[0]?.body).includes(KEY), false);
    assert.deepEqual(vectors[0], vector(1));
    assert.deepEqual(vectors[1], vector(2));
    assert.deepEqual(vectors[2], vector(1));
  });

  it("rejects a bad count, index, dimension, NaN, or Infinity", async () => {
    const cases: unknown[] = [
      { data: [{ index: 0, embedding: [1, 2, 3] }, { index: 1, embedding: [1, 2, 3] }] },
      { data: [{ index: 2, embedding: [1, 2, 3] }] },
      { data: [{ index: 0, embedding: [1, 2, 3] }, { index: 0, embedding: [4, 5, 6] }] },
      { data: [{ index: 0, embedding: [1, 2] }] },
      { data: [{ index: 0, embedding: [Number.NaN, 1, 2] }] },
      { data: [{ index: 0, embedding: [1, Number.POSITIVE_INFINITY, 2] }] },
    ];

    for (const body of cases) {
      const embedder = createVoyageEmbedder({
        inputType: "document",
        outputDimension: 1024,
        env: { VOYAGE_API_KEY: KEY },
        fetch: mockFetch(async () => new Response(JSON.stringify(body), { status: 200 })),
      });
      await assert.rejects(() => embedder.embedTexts([SOURCE]), (error: unknown) => {
        assert.ok(error instanceof EmbeddingValidationError || error instanceof EmbeddingProviderError);
        assert.equal(String(error).includes(KEY), false);
        assert.equal(String(error).includes(SOURCE), false);
        return true;
      });
    }
  });

  it("maps HTTP 429, HTTP 5xx, and network failure without retrying", async () => {
    let calls = 0;
    const limited = createVoyageEmbedder({
      inputType: "document",
      env: { VOYAGE_API_KEY: KEY },
      fetch: mockFetch(async () => {
        calls += 1;
        return new Response(JSON.stringify({ detail: KEY, text: SOURCE }), { status: 429 });
      }),
    });
    await assert.rejects(() => limited.embedTexts([SOURCE]), (error: unknown) => {
      assertSafe(error, "rate_limited");
      return true;
    });
    assert.equal(calls, 1);

    const down = createVoyageEmbedder({
      inputType: "document",
      env: { VOYAGE_API_KEY: KEY },
      fetch: mockFetch(async () => new Response(KEY, { status: 503 })),
    });
    await assert.rejects(() => down.embedTexts([SOURCE]), (error: unknown) => {
      assertSafe(error, "unavailable");
      return true;
    });

    const offline = createVoyageEmbedder({
      inputType: "document",
      env: { VOYAGE_API_KEY: KEY },
      fetch: mockFetch(async () => {
        throw new TypeError(`connect ${KEY}`);
      }),
    });
    await assert.rejects(() => offline.embedTexts([SOURCE]), (error: unknown) => {
      assertSafe(error, "unavailable");
      return true;
    });
  });

  it("aborts on the timeout and when the caller cancels", async () => {
    const timed = createVoyageEmbedder({
      inputType: "document",
      timeoutMs: 30,
      env: { VOYAGE_API_KEY: KEY },
      fetch: mockFetch(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              const error = new Error(`timed out ${KEY}`);
              error.name = "AbortError";
              reject(error);
            });
          }),
      ),
    });
    await assert.rejects(() => timed.embedTexts([SOURCE]), (error: unknown) => {
      assertSafe(error, "timeout");
      return true;
    });

    const controller = new AbortController();
    let fetches = 0;
    const pending = createVoyageEmbedder({
      inputType: "query",
      signal: controller.signal,
      timeoutMs: 20_000,
      env: { VOYAGE_API_KEY: KEY },
      fetch: mockFetch(
        (_url, init) => {
          fetches += 1;
          return new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              const error = new Error(`cancelled ${KEY}`);
              error.name = "AbortError";
              reject(error);
            });
          });
        },
      ),
    }).embedTexts([SOURCE]);
    controller.abort();
    await assert.rejects(pending, (error: unknown) => {
      assertSafe(error, "timeout");
      return true;
    });
    assert.equal(fetches, 1);
  });
});
