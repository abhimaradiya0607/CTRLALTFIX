
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AiProviderError,
  DEFAULT_GROQ_TEXT_MODEL,
  type AiErrorCode,
  type GroqProviderEnv,
  cleanSuggestionText,
  enhancedPromptOrOriginal,
  generateJson,
  generateText,
  resolveGroqTextModel,
  resolveRequestTimeoutMs,
  suggestionOrFallback,
} from "./groq-provider.ts";

const KEY = "test-groq-key-do-not-leak";
const PROMPT = "project source that must stay out of errors";

function env(overrides: GroqProviderEnv = {}): GroqProviderEnv {
  return { GROQ_API_KEY: KEY, ...overrides };
}

function mockFetch(
  handler: (url: string, init: RequestInit) => Promise<Response> | Response,
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init ?? {})) as typeof fetch;
}

function groqResponse(
  content: string,
  status = 200,
): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function assertSafeError(
  error: unknown,
  code: AiErrorCode,
): asserts error is AiProviderError {
  assert.ok(error instanceof AiProviderError);
  assert.equal(error.name, "AiProviderError");
  assert.equal(error.code, code);

  const rendered = `${error.message}\n${String(error)}\n${error.status}`;
  assert.equal(rendered.includes(KEY), false);
  assert.equal(rendered.includes(PROMPT), false);
}

describe("Groq provider configuration", () => {
  it("uses the default model when none is configured", () => {
    assert.equal(resolveGroqTextModel({}), DEFAULT_GROQ_TEXT_MODEL);
    assert.equal(DEFAULT_GROQ_TEXT_MODEL, "openai/gpt-oss-20b");
  });

  it("accepts a model ID and rejects a path-like override", () => {
    assert.equal(
      resolveGroqTextModel({ GROQ_MODEL: "openai/gpt-oss-20b" }),
      "openai/gpt-oss-20b",
    );

    assert.throws(
      () => resolveGroqTextModel({ GROQ_MODEL: "../other-model" }),
      (error: unknown) =>
        error instanceof AiProviderError &&
        error.code === "not_configured",
    );
  });

  it("clamps timeout to the provider maximum", () => {
    assert.equal(resolveRequestTimeoutMs({}), 20_000);
    assert.equal(
      resolveRequestTimeoutMs({ AI_REQUEST_TIMEOUT_MS: "50" }),
      50,
    );
    assert.equal(
      resolveRequestTimeoutMs({ AI_REQUEST_TIMEOUT_MS: "999999" }),
      20_000,
    );
    assert.equal(
      resolveRequestTimeoutMs({ AI_REQUEST_TIMEOUT_MS: "0" }),
      20_000,
    );
  });
});

describe("Groq text generation", () => {
  it("sends an authenticated request and returns trimmed text", async () => {
    const requests: { url: string; init: RequestInit }[] = [];

    const result = await generateText(
      { prompt: PROMPT, temperature: 0.7, topP: 0.9, maxOutputTokens: 100 },
      {
        env: env(),
        fetch: mockFetch((url, init) => {
          requests.push({ url, init });
          return groqResponse("  CTRLALTFIX_GROQ_OK  ");
        }),
      },
    );

    assert.equal(result, "CTRLALTFIX_GROQ_OK");
    assert.equal(requests.length, 1);

    const request = requests[0];
    assert.ok(request);
    assert.equal(
      request.url,
      "https://api.groq.com/openai/v1/chat/completions",
    );

    const headers = new Headers(request.init.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${KEY}`);

    const body = JSON.parse(String(request.init.body));
    assert.equal(body.model, DEFAULT_GROQ_TEXT_MODEL);
    assert.deepEqual(body.messages, [{ role: "user", content: PROMPT }]);
    assert.equal(body.temperature, 0.7);
    assert.equal(body.top_p, 0.9);
    assert.equal(body.max_completion_tokens, 100);
    assert.equal(JSON.stringify(body).includes(KEY), false);
  });

  it("does not call the network when the API key is missing", async () => {
    let calls = 0;

    await assert.rejects(
      () =>
        generateText(
          { prompt: PROMPT, temperature: 0.7, maxOutputTokens: 100 },
          {
            env: {},
            fetch: mockFetch(() => {
              calls += 1;
              return groqResponse("should not run");
            }),
          },
        ),
      (error: unknown) => {
        assertSafeError(error, "not_configured");
        return true;
      },
    );

    assert.equal(calls, 0);
  });

  it("requests JSON mode for edit proposals", async () => {
    let requestBody: Record<string, unknown> | undefined;

    const raw = await generateJson(
      { prompt: PROMPT, temperature: 0.2, maxOutputTokens: 4096 },
      {
        env: env(),
        fetch: mockFetch((_url, init) => {
          requestBody = JSON.parse(String(init.body));
          return groqResponse(
            JSON.stringify({
              oldText: "const a = 1;",
              newText: "const a = 2;",
            }),
          );
        }),
      },
    );

    assert.equal(
      (requestBody?.response_format as { type?: string })?.type,
      "json_object",
    );
    assert.deepEqual(JSON.parse(raw), {
      oldText: "const a = 1;",
      newText: "const a = 2;",
    });
  });

  it("maps HTTP errors without leaking provider response bodies", async () => {
    const cases: { status: number; code: AiErrorCode }[] = [
      { status: 429, code: "rate_limited" },
      { status: 401, code: "not_configured" },
      { status: 403, code: "not_configured" },
      { status: 503, code: "unavailable" },
    ];

    for (const item of cases) {
      await assert.rejects(
        () =>
          generateText(
            { prompt: PROMPT, temperature: 0.7, maxOutputTokens: 100 },
            {
              env: env(),
              fetch: mockFetch(
                () =>
                  new Response(
                    JSON.stringify({
                      error: { message: `${KEY} ${PROMPT}` },
                    }),
                    { status: item.status },
                  ),
              ),
            },
          ),
        (error: unknown) => {
          assertSafeError(error, item.code);
          assert.equal(error.status, item.status);
          return true;
        },
      );
    }
  });

  it("maps network failures to unavailable", async () => {
    await assert.rejects(
      () =>
        generateText(
          { prompt: PROMPT, temperature: 0.7, maxOutputTokens: 100 },
          {
            env: env(),
            fetch: mockFetch(() => {
              throw new TypeError(`network failure ${KEY}`);
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

  it("rejects malformed or empty responses", async () => {
    const responses = [
      new Response("not-json", { status: 200 }),
      new Response(JSON.stringify({ choices: [] }), { status: 200 }),
      groqResponse("   "),
    ];

    for (const response of responses) {
      await assert.rejects(
        () =>
          generateText(
            { prompt: PROMPT, temperature: 0.7, maxOutputTokens: 100 },
            { env: env(), fetch: mockFetch(() => response) },
          ),
        (error: unknown) => {
          assertSafeError(error, "invalid_response");
          return true;
        },
      );
    }
  });
});

describe("Groq fallback helpers", () => {
  it("cleans code fences and cursor markers", () => {
    assert.equal(
      cleanSuggestionText("```ts\nconst x = 1;\n```"),
      "const x = 1;",
    );
    assert.equal(cleanSuggestionText("  foo|CURSOR|bar  "), "foobar");
  });

  it("returns the original prompt if enhancement fails", async () => {
    const original = "Fix this TypeScript error";

    const result = await enhancedPromptOrOriginal(
      { prompt: original },
      {
        env: {},
        fetch: mockFetch(() => {
          throw new Error("should not be called");
        }),
      },
    );

    assert.equal(result, original);
  });

  it("returns the fallback when code suggestions fail", async () => {
    const result = await suggestionOrFallback(PROMPT, {
      env: {},
      fetch: mockFetch(() => {
        throw new Error("should not be called");
      }),
    });

    assert.equal(result, "//AI suggestion unavailable");
  });

  it("returns cleaned code suggestions", async () => {
    const result = await suggestionOrFallback("complete this", {
      env: env(),
      fetch: mockFetch(() => groqResponse("```ts\nconst value = 42;\n```")),
    });

    assert.equal(result, "const value = 42;");
  });
});
