import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chatFailureCode } from "../../ai-chat/lib/chat-reply.ts";
import { parseEditPatch } from "../../ai-chat/lib/edit-proposal.ts";
import {
  AiProviderError,
  DEFAULT_GEMINI_TEXT_MODEL,
  MAX_AI_REQUEST_TIMEOUT_MS,
  type AiErrorCode,
  type GeminiProviderEnv,
  cleanSuggestionText,
  enhancedPromptOrOriginal,
  generateJson,
  generateText,
  resolveGeminiTextModel,
  resolveRequestTimeoutMs,
  suggestionOrFallback,
} from "./gemini-provider.ts";

const KEY = "test-gemini-key-do-not-leak";
const PROMPT = "project source that must stay out of errors";

function env(overrides: GeminiProviderEnv = {}): GeminiProviderEnv {
  return { GEMINI_API_KEY: KEY, ...overrides };
}

function mockFetch(
  handler: (url: string, init: RequestInit) => Promise<Response> | Response,
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init ?? {})) as typeof fetch;
}

function candidateResponse(parts: unknown[], status = 200): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts } }] }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function assertSafeError(error: unknown, code: AiErrorCode): asserts error is AiProviderError {
  assert.ok(error instanceof AiProviderError);
  assert.equal(error.name, "AiProviderError");
  assert.equal(error.code, code);
  const rendered = `${error.message}\n${String(error)}\n${error.status}`;
  assert.equal(rendered.includes(KEY), false);
  assert.equal(rendered.includes(PROMPT), false);
  assert.equal(rendered.includes("AbortError"), false);
}

describe("Gemini text configuration", () => {
  it("uses gemini-3.8-flash when no model is configured", () => {
    assert.equal(resolveGeminiTextModel({}), DEFAULT_GEMINI_TEXT_MODEL);
    assert.equal(DEFAULT_GEMINI_TEXT_MODEL, "gemini-3.8-flash");
  });

  it("accepts a server model id and rejects a path-like override", () => {
    assert.equal(resolveGeminiTextModel({ GEMINI_TEXT_MODEL: "gemini-3.6-flash" }), "gemini-3.6-flash");
    assert.throws(
      () => resolveGeminiTextModel({ GEMINI_TEXT_MODEL: "../other-model" }),
      (error: unknown) => error instanceof AiProviderError && error.code === "not_configured",
    );
  });

  it("clamps the request timeout at 20 seconds", () => {
    assert.equal(resolveRequestTimeoutMs({}), MAX_AI_REQUEST_TIMEOUT_MS);
    assert.equal(resolveRequestTimeoutMs({ AI_REQUEST_TIMEOUT_MS: "50" }), 50);
    assert.equal(resolveRequestTimeoutMs({ AI_REQUEST_TIMEOUT_MS: "999999" }), 20_000);
    assert.equal(resolveRequestTimeoutMs({ AI_REQUEST_TIMEOUT_MS: "0" }), 20_000);
    assert.equal(resolveRequestTimeoutMs({ AI_REQUEST_TIMEOUT_MS: "nope" }), 20_000);
  });
});

describe("Gemini text generation", () => {
  it("does not call the network when the API key is missing", async () => {
    let calls = 0;
    const fetchImpl = mockFetch(() => {
      calls += 1;
      return candidateResponse([{ text: "should not run" }]);
    });

    await assert.rejects(
      () =>
        generateText(
          { prompt: PROMPT, temperature: 0.7, maxOutputTokens: 1000 },
          { env: { GEMINI_TEXT_MODEL: "gemini-3.8-flash" }, fetch: fetchImpl },
        ),
      (error: unknown) => {
        assertSafeError(error, "not_configured");
        return true;
      },
    );
    assert.equal(calls, 0);
  });

  it("returns trimmed answer text and skips thought parts", async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const text = await generateText(
      { prompt: PROMPT, temperature: 0.7, topP: 0.9, maxOutputTokens: 1000 },
      {
        env: env(),
        fetch: mockFetch(async (url, init) => {
          requests.push({ url, init });
          return candidateResponse([
            { thought: true, text: `reasoning ${KEY}` },
            { text: "  The entry point is index.js.  " },
          ]);
        }),
      },
    );

    assert.equal(text, "The entry point is index.js.");
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.ok(request);
    assert.equal(request.url.includes(KEY), false);
    assert.equal(
      request.url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    );
    const headers = new Headers(request.init.headers);
    assert.equal(headers.get("x-goog-api-key"), KEY);
    const body = JSON.parse(String(request.init.body)) as {
      contents: { parts: { text: string }[] }[];
      generationConfig: { temperature: number; maxOutputTokens: number; topP: number; responseFormat?: unknown };
    };
    assert.equal(body.contents[0]?.parts[0]?.text, PROMPT);
    assert.equal(body.generationConfig.temperature, 0.7);
    assert.equal(body.generationConfig.maxOutputTokens, 1000);
    assert.equal(body.generationConfig.topP, 0.9);
    assert.equal(body.generationConfig.responseFormat, undefined);
    assert.equal(JSON.stringify(body).includes(KEY), false);
    assert.equal(chatFailureCode(new AiProviderError("timeout")), "timeout");
    assert.equal(chatFailureCode(new AiProviderError("invalid_response")), "empty");
    assert.equal(chatFailureCode(new AiProviderError("rate_limited", 429)), "model_error");
    assert.equal(chatFailureCode(new AiProviderError("unavailable", 503)), "model_error");
    assert.equal(chatFailureCode(new AiProviderError("not_configured")), "model_error");
  });

  it("sends an edit as structured JSON and still leaves patch checks to parseEditPatch", async () => {
    let schema: unknown;
    const raw = await generateJson(
      { prompt: PROMPT, temperature: 0.2, maxOutputTokens: 4096 },
      {
        env: env({ GEMINI_TEXT_MODEL: "gemini-3.8-flash" }),
        fetch: mockFetch(async (_url, init) => {
          const body = JSON.parse(String(init.body)) as {
            generationConfig: { responseFormat: { text: { mimeType: string; schema: unknown } } };
          };
          schema = body.generationConfig.responseFormat.text.schema;
          return candidateResponse([{ text: JSON.stringify({ oldText: "const a = 1;", newText: "const a = 2;" }) }]);
        }),
      },
    );

    assert.deepEqual(schema, {
      type: "object",
      properties: {
        oldText: {
          type: "string",
          description: "Exact text copied from the file. It must identify one place.",
        },
        newText: {
          type: "string",
          description: "That same anchor with only the requested change.",
        },
      },
      required: ["oldText", "newText"],
      additionalProperties: false,
    });
    assert.deepEqual(parseEditPatch(raw), { oldText: "const a = 1;", newText: "const a = 2;" });

    const invalid = await generateJson(
      { prompt: PROMPT, temperature: 0.2, maxOutputTokens: 4096 },
      {
        env: env(),
        fetch: mockFetch(async () => candidateResponse([{ text: JSON.stringify({ content: "<p>AI</p>" }) }])),
      },
    );
    assert.equal(parseEditPatch(invalid), "malformed");
    assert.equal(parseEditPatch("not json"), "malformed");
  });

  it("rejects an empty or malformed provider body", async () => {
    const cases = [
      new Response("not-json", { status: 200 }),
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
      candidateResponse([{ thought: true, text: "hidden" }]),
      candidateResponse([{ text: "   " }]),
      candidateResponse([]),
    ];

    for (const response of cases) {
      await assert.rejects(
        () =>
          generateText(
            { prompt: PROMPT, temperature: 0.7, maxOutputTokens: 100 },
            {
              env: env(),
              fetch: mockFetch(async () => response),
            },
          ),
        (error: unknown) => {
          assertSafeError(error, "invalid_response");
          return true;
        },
      );
    }
  });

  it("maps HTTP 429 once, without retrying or copying the provider body", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        generateText(
          { prompt: PROMPT, temperature: 0.7, maxOutputTokens: 100 },
          {
            env: env(),
            fetch: mockFetch(async () => {
              calls += 1;
              return new Response(JSON.stringify({ error: { message: KEY, prompt: PROMPT } }), { status: 429 });
            }),
          },
        ),
      (error: unknown) => {
        assertSafeError(error, "rate_limited");
        assert.equal(error.status, 429);
        return true;
      },
    );
    assert.equal(calls, 1);
  });

  it("maps HTTP 5xx and network failures to unavailable", async () => {
    await assert.rejects(
      () =>
        generateText(
          { prompt: PROMPT, temperature: 0.7, maxOutputTokens: 100 },
          {
            env: env(),
            fetch: mockFetch(async () => new Response(KEY, { status: 503 })),
          },
        ),
      (error: unknown) => {
        assertSafeError(error, "unavailable");
        assert.equal(error.status, 503);
        return true;
      },
    );

    await assert.rejects(
      () =>
        generateText(
          { prompt: PROMPT, temperature: 0.7, maxOutputTokens: 100 },
          {
            env: env(),
            fetch: mockFetch(async () => {
              throw new TypeError(`connect failed for ${KEY}`);
            }),
          },
        ),
      (error: unknown) => {
        assertSafeError(error, "unavailable");
        assert.equal(error.status, 0);
        return true;
      },
    );
  });

  it("aborts on the clamped timeout", async () => {
    await assert.rejects(
      () =>
        generateText(
          { prompt: PROMPT, temperature: 0.7, maxOutputTokens: 100 },
          {
            env: env({ AI_REQUEST_TIMEOUT_MS: "30" }),
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
          },
        ),
      (error: unknown) => {
        assertSafeError(error, "timeout");
        return true;
      },
    );
  });

  it("cancels an in-flight request when the caller aborts", async () => {
    const controller = new AbortController();
    let fetches = 0;
    let sawAborted = false;
    const pending = generateText(
      { prompt: PROMPT, temperature: 0.7, maxOutputTokens: 100, signal: controller.signal },
      {
        env: env({ AI_REQUEST_TIMEOUT_MS: "20000" }),
        fetch: mockFetch(
          (_url, init) => {
            fetches += 1;
            return new Promise((_resolve, reject) => {
              init.signal?.addEventListener("abort", () => {
                sawAborted = true;
                const error = new Error(`cancelled ${KEY}`);
                error.name = "AbortError";
                reject(error);
              });
            });
          },
        ),
      },
    );
    controller.abort();

    await assert.rejects(pending, (error: unknown) => {
      assertSafeError(error, "timeout");
      return true;
    });
    assert.equal(fetches, 1);
    assert.equal(sawAborted, true);
  });

  it("does not start a request that is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await assert.rejects(
      () =>
        generateText(
          { prompt: PROMPT, temperature: 0.7, maxOutputTokens: 100, signal: controller.signal },
          {
            env: env(),
            fetch: mockFetch(() => {
              calls += 1;
              return candidateResponse([{ text: "late" }]);
            }),
          },
        ),
      (error: unknown) => {
        assertSafeError(error, "timeout");
        return true;
      },
    );
    assert.equal(calls, 0);
  });
});

describe("existing text route contracts", () => {
  it("returns the original prompt when enhancement fails", async () => {
    let calls = 0;
    const original = "make the button blue";
    const missingKey = await enhancedPromptOrOriginal(
      { prompt: original },
      {
        env: {},
        fetch: mockFetch(() => {
          calls += 1;
          return candidateResponse([{ text: "should not run" }]);
        }),
      },
    );
    assert.equal(missingKey, original);
    assert.equal(calls, 0);

    const failed = await enhancedPromptOrOriginal(
      { prompt: original, context: { fileName: "App.tsx", codeContent: PROMPT, language: "TypeScript" } },
      {
        env: env(),
        fetch: mockFetch(async () => new Response(JSON.stringify({ error: KEY }), { status: 500 })),
      },
    );
    assert.equal(failed, original);
    assert.equal(failed.includes(KEY), false);
  });

  it("keeps a successful enhancement and the suggestion fallback", async () => {
    const enhanced = await enhancedPromptOrOriginal(
      { prompt: "make the button blue" },
      {
        env: env(),
        fetch: mockFetch(async () => candidateResponse([{ text: "  Explain the button color change in App.tsx.  " }])),
      },
    );
    assert.equal(enhanced, "Explain the button color change in App.tsx.");

    const suggestion = await suggestionOrFallback("complete this", {
      env: env(),
      fetch: mockFetch(async () =>
        candidateResponse([{ text: "```ts\nconst ready = true;\n```\n|CURSOR|" }]),
      ),
    });
    assert.equal(suggestion, "const ready = true;");
    assert.equal(cleanSuggestionText("```ts\nconst ready = true;\n```"), "const ready = true;");

    const fallback = await suggestionOrFallback(PROMPT, {
      env: env(),
      fetch: mockFetch(async () => new Response(`secret ${KEY}`, { status: 429 })),
    });
    assert.equal(fallback, "//AI suggestion unavailable");
    assert.equal(fallback.includes(KEY), false);
    assert.equal(fallback.includes(PROMPT), false);
  });
});
