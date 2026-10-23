
/**
 * Server-only Groq text client.
 * The API key is read from the environment and sent only in the request header.
 */

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export const DEFAULT_GROQ_TEXT_MODEL = "openai/gpt-oss-20b";
export const MAX_AI_REQUEST_TIMEOUT_MS = 20_000;

const MESSAGES = {
  not_configured: "AI model is not configured",
  rate_limited: "AI model rate limit reached",
  unavailable: "AI model is unavailable",
  invalid_response: "No response from AI model",
  timeout: "Request timeout: AI model took too long to respond",
} as const;

export type AiErrorCode = keyof typeof MESSAGES;

export class AiProviderError extends Error {
  readonly code: AiErrorCode;
  readonly status: number;

  constructor(code: AiErrorCode, status = 0) {
    super(MESSAGES[code]);
    this.name = "AiProviderError";
    this.code = code;
    this.status = status;
  }
}

export type GroqProviderEnv = {
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  AI_REQUEST_TIMEOUT_MS?: string;
};

export type GroqCallOptions = {
  signal?: AbortSignal;
  env?: GroqProviderEnv;
  fetch?: typeof fetch;
};

type TextRequest = {
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  topP?: number;
  signal?: AbortSignal;
};

const EDIT_PATCH_JSON_SCHEMA = {
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
} as const;

function providerEnv(options?: GroqCallOptions): GroqProviderEnv {
  if (options?.env) return options.env;

  return {
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GROQ_MODEL: process.env.GROQ_MODEL,
    AI_REQUEST_TIMEOUT_MS: process.env.AI_REQUEST_TIMEOUT_MS,
  };
}

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new AiProviderError("not_configured");
  }
}

function apiKey(env: GroqProviderEnv): string {
  const key = env.GROQ_API_KEY?.trim() ?? "";
  if (!key) throw new AiProviderError("not_configured");
  return key;
}

export function resolveGroqTextModel(
  env: GroqProviderEnv = providerEnv(),
): string {
  const model = env.GROQ_MODEL?.trim() || DEFAULT_GROQ_TEXT_MODEL;

  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(model)) {
    throw new AiProviderError("not_configured");
  }

  return model;
}

export function resolveRequestTimeoutMs(
  env: GroqProviderEnv = providerEnv(),
): number {
  const raw = env.AI_REQUEST_TIMEOUT_MS?.trim() ?? "";
  if (!raw) return MAX_AI_REQUEST_TIMEOUT_MS;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    return MAX_AI_REQUEST_TIMEOUT_MS;
  }

  return Math.min(Math.floor(value), MAX_AI_REQUEST_TIMEOUT_MS);
}

function linkTimeout(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onParent = () => controller.abort();

  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", onParent, { once: true });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParent);
    },
  };
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The HTTP status is sufficient; don't expose provider response bodies.
  }
}

function statusError(status: number): AiProviderError {
  if (status === 429) return new AiProviderError("rate_limited", status);
  if (status === 401 || status === 403) {
    return new AiProviderError("not_configured", status);
  }
  return new AiProviderError("unavailable", status);
}

function extractMessageContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new AiProviderError("invalid_response");
  }

  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new AiProviderError("invalid_response");
  }

  const message = (
    choices[0] as { message?: { content?: unknown } } | undefined
  )?.message;

  const content = message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new AiProviderError("invalid_response");
  }

  return content.trim();
}

async function generateContent(
  input: TextRequest,
  options?: GroqCallOptions,
  jsonMode = false,
): Promise<string> {
  assertServer();

  const env = providerEnv(options);
  const key = apiKey(env);
  const model = resolveGroqTextModel(env);
  const timeoutMs = resolveRequestTimeoutMs(env);
  const parent = input.signal ?? options?.signal;

  if (parent?.aborted) {
    throw new AiProviderError("timeout");
  }

  const linked = linkTimeout(parent, timeoutMs);
  const fetchImpl = options?.fetch ?? fetch;

  try {
    const response = await fetchImpl(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: input.prompt }],
        temperature: input.temperature,
        max_completion_tokens: input.maxOutputTokens,
        ...(input.topP !== undefined ? { top_p: input.topP } : {}),
        ...(jsonMode
          ? { response_format: { type: "json_object" } }
          : {}),
      }),
      signal: linked.signal,
    });

    if (!response.ok) {
      await discardBody(response);
      throw statusError(response.status);
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      console.error("Groq returned a non-JSON response");
      throw new AiProviderError("invalid_response");
    }

    try {
      return extractMessageContent(payload);
    } catch (error) {
      if (error instanceof AiProviderError) {
        const data = payload as {
          choices?: Array<{
            finish_reason?: unknown;
            message?: {
              content?: unknown;
              refusal?: unknown;
            };
          }>;
        };

        const firstChoice = Array.isArray(data?.choices)
          ? data.choices[0]
          : undefined;

        console.error("Groq response structure:", {
          hasChoices: Array.isArray(data?.choices),
          choiceCount: Array.isArray(data?.choices)
            ? data.choices.length
            : 0,
          finishReason: firstChoice?.finish_reason ?? null,
          contentType: typeof firstChoice?.message?.content,
          contentLength:
            typeof firstChoice?.message?.content === "string"
              ? firstChoice.message.content.length
              : null,
          hasRefusal: Boolean(firstChoice?.message?.refusal),
        });
      }

      throw error;
    }
  } catch (error) {
    if (error instanceof AiProviderError) {
      throw error;
    }

    if (
      (error instanceof Error && error.name === "AbortError") ||
      linked.signal.aborted ||
      parent?.aborted
    ) {
      throw new AiProviderError("timeout");
    }

    throw new AiProviderError("unavailable");
  } finally {
    linked.dispose();
  }
}

export function generateText(
  input: TextRequest,
  options?: GroqCallOptions,
): Promise<string> {
  return generateContent(input, options);
}

export function generateJson(
  input: Omit<TextRequest, "topP">,
  options?: GroqCallOptions,
): Promise<string> {
  return generateContent(input, options, true);
}

type EnhancePromptRequest = {
  prompt: string;
  context?: {
    fileName?: string;
    codeContent?: string;
    language?: string;
  };
};

export async function enhancedPromptOrOriginal(
  request: EnhancePromptRequest,
  options?: GroqCallOptions,
): Promise<string> {
  const enhancementPrompt = `You are a prompt enhancement assistant. Take the user's basic prompt and enhance it to be more specific, detailed, and effective for a coding AI assistant.

Original prompt: "${request.prompt}"
Context: ${request.context ? JSON.stringify(request.context, null, 2) : "No additional context"}

Enhanced prompt should:
- Be more specific and detailed
- Include relevant technical context
- Ask for specific examples or explanations
- Be clear about expected output format
- Maintain the original intent

Return only the enhanced prompt, nothing else.`;

  try {
    return await generateText(
      {
        prompt: enhancementPrompt,
        temperature: 0.3,
        maxOutputTokens: 500,
        signal: options?.signal,
      },
      options,
    );
  } catch {
    console.error("Prompt enhancement error");
    return request.prompt;
  }
}

export function cleanSuggestionText(suggestion: string): string {
  let text = suggestion;

  if (text.includes("```")) {
    const codeMatch = text.match(/```[\w+]*\n?([\s\S]*?)```/);
    text = codeMatch ? codeMatch[1].trim() : text;
  }

  return text.replace(/\|CURSOR\|/g, "").trim();
}

export async function suggestionOrFallback(
  prompt: string,
  options?: GroqCallOptions,
): Promise<string> {
  try {
    const suggestion = await generateText(
      {
        prompt,
        temperature: 0.7,
        maxOutputTokens: 512,
        signal: options?.signal,
      },
      options,
    );

    return cleanSuggestionText(suggestion);
  } catch (error) {
    if (error instanceof AiProviderError) {
      console.error("Code suggestion model request failed:", {
        code: error.code,
        status: error.status,
      });
    } else {
      console.error("Code suggestion model request failed: unexpected error");
    }

    return "//AI suggestion unavailable";
  }
}
