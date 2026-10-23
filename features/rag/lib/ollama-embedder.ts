import {
  EmbeddingProviderError,
  EmbeddingValidationError,
  validateEmbeddingVectors,
  type EmbeddingProvider,
} from "./embed-chunks.ts";

export const OLLAMA_EMBED_TIMEOUT_MS = 120_000;
export const DEFAULT_OLLAMA_EMBED_BATCH_SIZE = 32;

export interface OllamaEmbedderConfig {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  maxBatchSize?: number;
  fetch?: typeof fetch;
}

interface OllamaEmbedResponse {
  embeddings?: unknown;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** Resolves Ollama base URL from env; requires explicit URL in production. */
export function resolveOllamaBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.OLLAMA_BASE_URL?.trim();
  if (fromEnv) return trimTrailingSlash(fromEnv);

  if (env.NODE_ENV === "production") {
    throw new EmbeddingProviderError("OLLAMA_BASE_URL must be set in production");
  }

  return "http://127.0.0.1:11434";
}

export function resolveOllamaEmbedModel(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const fromEnv = env.OLLAMA_EMBED_MODEL?.trim();
  return fromEnv || undefined;
}

function parseEmbedResponseBody(body: unknown, expectedCount: number): number[][] {
  if (body === null || typeof body !== "object") {
    throw new EmbeddingProviderError("Ollama embed response was not a JSON object");
  }

  const { embeddings } = body as OllamaEmbedResponse;
  if (!Array.isArray(embeddings)) {
    throw new EmbeddingProviderError("Ollama embed response missing embeddings array");
  }

  validateEmbeddingVectors(embeddings, expectedCount);
  return (embeddings as number[][]).map((vector) => [...vector]);
}

async function postEmbedBatch(
  config: OllamaEmbedderConfig,
  texts: readonly string[],
): Promise<number[][]> {
  const fetchFn = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? OLLAMA_EMBED_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const url = `${trimTrailingSlash(config.baseUrl)}/api/embed`;

  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        input: texts,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new EmbeddingProviderError(`Ollama embed request failed with status ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new EmbeddingProviderError("Ollama embed response was not valid JSON");
    }

    return parseEmbedResponseBody(body, texts.length);
  } catch (error) {
    if (error instanceof EmbeddingProviderError || error instanceof EmbeddingValidationError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new EmbeddingProviderError(`Ollama embed request timed out after ${timeoutMs}ms`);
    }
    throw new EmbeddingProviderError(
      error instanceof Error ? error.message : "Ollama embed request failed",
      { cause: error },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Ollama `/api/embed` provider. Batches are sent sequentially and each batch is
 * validated for an exact vector count, so concatenating them preserves input order.
 */
export function createOllamaEmbedder(config: OllamaEmbedderConfig): EmbeddingProvider {
  const maxBatchSize = Math.max(1, config.maxBatchSize ?? DEFAULT_OLLAMA_EMBED_BATCH_SIZE);

  return {
    async embedTexts(texts) {
      const allVectors: number[][] = [];
      for (let start = 0; start < texts.length; start += maxBatchSize) {
        const batch = texts.slice(start, start + maxBatchSize);
        allVectors.push(...(await postEmbedBatch(config, batch)));
      }
      return allVectors;
    },
  };
}
