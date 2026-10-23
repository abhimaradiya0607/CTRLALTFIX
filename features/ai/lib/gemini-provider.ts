/**
 * Server-only Gemini text client.
 * The API key is read from the environment here and sent only as a request header.
 */

const GENERATE_CONTENT_ORIGIN = "https://generativelanguage.googleapis.com/v1beta/models";

export const DEFAULT_GEMINI_TEXT_MODEL = "gemini-3.8-flash";
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

export type GeminiProviderEnv = {
  GEMINI_API_KEY?: string;
  GEMINI_TEXT_MODEL?: string;
  AI_REQUEST_TIMEOUT_MS?: string;
};

export type GeminiCallOptions = {
  signal?: AbortSignal;
  env?: GeminiProviderEnv;
  fetch?: typeof fetch;
};

type TextRequest = {
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  topP?: number;
  signal?: AbortSignal;
};

const EDIT_PATCH_RESPONSE_SCHEMA = {
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

function providerEnv(options?: GeminiCallOptions): GeminiProviderEnv {
  if (options?.env) return options.env;
  return {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_TEXT_MODEL: process.env.GEMINI_TEXT_MODEL,
    AI_REQUEST_TIMEOUT_MS: process.env.AI_REQUEST_TIMEOUT_MS,
  };
}

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new AiProviderError("not_configured");
  }
}

function apiKey(env: GeminiProviderEnv): string {
  const key = env.GEMINI_API_KEY?.trim() ?? "";
  if (key.length === 0) throw new AiProviderError("not_configured");
  return key;
}

export function resolveGeminiTextModel(env: GeminiProviderEnv = providerEnv()): string {
  const model = env.GEMINI_TEXT_MODEL?.trim() ?? "";
  if (model.length === 0) return DEFAULT_GEMINI_TEXT_MODEL;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(model)) {
    throw new AiProviderError("not_configured");
  }
  return model;
}

export function resolveRequestTimeoutMs(env: GeminiProviderEnv = providerEnv()): number {
  const raw = env.AI_REQUEST_TIMEOUT_MS?.trim() ?? "";
  if (raw.length === 0) return MAX_AI_REQUEST_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return MAX_AI_REQUEST_TIMEOUT_MS;
  return Math.min(Math.floor(value), MAX_AI_REQUEST_TIMEOUT_MS);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function linkTimeout(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  dispose: () => void;
} {
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
    // The HTTP status is enough. The body is not copied into the error.
  }
}

function textFromCandidate(body: unknown): string {
  if (!body || typeof body !== "object") throw new AiProviderError("invalid_response");
  const candidates = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new AiProviderError("invalid_response");
  }
  const content = (candidates[0] as { content?: unknown } | undefined)?.content;
  if (!content || typeof content !== "object") throw new AiProviderError("invalid_response");
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) throw new AiProviderError("invalid_response");

  const text = parts
    .filter((part) => {
      if (!part || typeof part !== "object") return false;
      return (part as { thought?: unknown }).thought !== true;
    })
    .map((part) => (part as { text?: unknown }).text)
    .filter((value): value is string => typeof value === "string")
    .join("");

  const trimmed = text.trim();
  if (trimmed.length === 0) throw new AiProviderError("invalid_response");
  return trimmed;
}

function statusError(status: number): AiProviderError {
  if (status === 429) return new AiProviderError("rate_limited", status);
  if (status === 401 || status === 403) return new AiProviderError("not_configured", status);
  return new AiProviderError("unavailable", status);
}

async function generateContent(
  input: TextRequest,
  options: GeminiCallOptions | undefined,
  responseFormat?: { text: { mimeType: "APPLICATION_JSON"; schema: typeof EDIT_PATCH_RESPONSE_SCHEMA } },
): Promise<string> {
  assertServer();
  const env = providerEnv(options);
  const key = apiKey(env);
  const model = resolveGeminiTextModel(env);
  const timeoutMs = resolveRequestTimeoutMs(env);
  const parent = input.signal ?? options?.signal;

  if (parent?.aborted) throw new AiProviderError("timeout");

  const linked = linkTimeout(parent, timeoutMs);
  const fetchImpl = options?.fetch ?? fetch;
  try {
    const response = await fetchImpl(
      `${GENERATE_CONTENT_ORIGIN}/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: input.prompt }] }],
          generationConfig: {
            temperature: input.temperature,
            maxOutputTokens: input.maxOutputTokens,
            ...(input.topP !== undefined ? { topP: input.topP } : {}),
            ...(responseFormat ? { responseFormat } : {}),
          },
        }),
        signal: linked.signal,
      },
    );

    if (!response.ok) {
      await discardBody(response);
      throw statusError(response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AiProviderError("invalid_response");
    }
    return textFromCandidate(payload);
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (isAbortError(error) || linked.signal.aborted || parent?.aborted) {
      throw new AiProviderError("timeout");
    }
    throw new AiProviderError("unavailable");
  } finally {
    linked.dispose();
  }
}

export function generateText(input: TextRequest, options?: GeminiCallOptions): Promise<string> {
  return generateContent(input, options);
}

export function generateJson(
  input: Omit<TextRequest, "topP">,
  options?: GeminiCallOptions,
): Promise<string> {
  return generateContent(input, options, {
    text: {
      mimeType: "APPLICATION_JSON",
      schema: EDIT_PATCH_RESPONSE_SCHEMA,
    },
  });
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
  options?: GeminiCallOptions,
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
  options?: GeminiCallOptions,
): Promise<string> {
  try {
    const suggestion = await generateText(
      {
        prompt,
        temperature: 0.7,
        maxOutputTokens: 300,
        signal: options?.signal,
      },
      options,
    );
    return cleanSuggestionText(suggestion);
  } catch (error) {
    const kind = error instanceof Error ? error.name : "UnknownError";
    console.error(`Code suggestion model request failed: ${kind}`);
    return "//AI suggestion unavailable";
  }
}
