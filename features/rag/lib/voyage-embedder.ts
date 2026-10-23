import {
  EmbeddingProviderError,
  EmbeddingValidationError,
  validateEmbeddingVectors,
  type EmbeddingProvider,
} from "./embed-chunks.ts";
import {
  resolveVoyageEmbedModel,
  resolveVoyageOutputDimension,
  type VoyageOutputDimension,
} from "./embedding-target.ts";

const EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings";

export const VOYAGE_EMBED_TIMEOUT_MS = 20_000;
export const MAX_VOYAGE_EMBED_BATCH_SIZE = 1_000;
export const DEFAULT_VOYAGE_EMBED_BATCH_SIZE = 32;

export interface VoyageEmbedderConfig {
  /** When omitted, read from the environment at call time. */
  apiKey?: string;
  model?: string;
  inputType: "query" | "document";
  outputDimension?: VoyageOutputDimension;
  timeoutMs?: number;
  maxBatchSize?: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new EmbeddingProviderError("Embedding service is not configured", { code: "not_configured" });
  }
}

function apiKey(config: VoyageEmbedderConfig): string {
  const source = config.env ?? process.env;
  const key = (config.apiKey ?? source.VOYAGE_API_KEY)?.trim() ?? "";
  if (key.length === 0) {
    throw new EmbeddingProviderError("Embedding service is not configured", { code: "not_configured" });
  }
  return key;
}

function modelFor(config: VoyageEmbedderConfig): string {
  try {
    const configured = config.model ?? (config.env ?? process.env).VOYAGE_EMBED_MODEL;
    return resolveVoyageEmbedModel({ VOYAGE_EMBED_MODEL: configured });
  } catch {
    throw new EmbeddingProviderError("Embedding service is not configured", { code: "not_configured" });
  }
}

function outputDimensionFor(config: VoyageEmbedderConfig): VoyageOutputDimension {
  try {
    if (config.outputDimension !== undefined) return config.outputDimension;
    return resolveVoyageOutputDimension({
      VOYAGE_EMBED_DIMENSIONS: (config.env ?? process.env).VOYAGE_EMBED_DIMENSIONS,
    });
  } catch {
    throw new EmbeddingProviderError("Embedding service is not configured", { code: "not_configured" });
  }
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
    // The status is enough. The body is not copied into the error.
  }
}

function statusError(status: number): EmbeddingProviderError {
  if (status === 429) {
    return new EmbeddingProviderError("Embedding service rate limit reached", {
      code: "rate_limited",
    });
  }
  if (status === 401 || status === 403) {
    return new EmbeddingProviderError("Embedding service is not configured", { code: "not_configured" });
  }
  return new EmbeddingProviderError("Embedding service is unavailable", { code: "unavailable" });
}

function vectorsInInputOrder(body: unknown, expectedCount: number, outputDimension: number): number[][] {
  if (!body || typeof body !== "object") {
    throw new EmbeddingProviderError("Embedding service returned an invalid response", {
      code: "invalid_response",
    });
  }
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new EmbeddingProviderError("Embedding service returned an invalid response", {
      code: "invalid_response",
    });
  }

  const slots: unknown[] = Array.from({ length: expectedCount });
  const seen = new Set<number>();
  for (const item of data) {
    if (!item || typeof item !== "object") {
      throw new EmbeddingValidationError("Embedding response item is not an object");
    }
    const index = (item as { index?: unknown }).index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= expectedCount || seen.has(index)) {
      throw new EmbeddingValidationError("Embedding response index is invalid");
    }
    seen.add(index);
    slots[index] = (item as { embedding?: unknown }).embedding;
  }
  if (seen.size !== expectedCount) {
    throw new EmbeddingValidationError(
      `Expected ${expectedCount} embedding vectors but received ${seen.size}`,
    );
  }

  const { dimensions } = validateEmbeddingVectors(slots, expectedCount);
  if (dimensions !== outputDimension) {
    throw new EmbeddingValidationError(
      `Embedding dimensions ${dimensions} do not match configured dimensions ${outputDimension}`,
    );
  }
  return (slots as number[][]).map((vector) => [...vector]);
}

async function postEmbedBatch(
  config: VoyageEmbedderConfig,
  texts: readonly string[],
  key: string,
  model: string,
  outputDimension: VoyageOutputDimension,
): Promise<number[][]> {
  const fetchFn = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? VOYAGE_EMBED_TIMEOUT_MS;
  if (config.signal?.aborted) {
    throw new EmbeddingProviderError("Embedding request timed out", { code: "timeout" });
  }
  const linked = linkTimeout(config.signal, timeoutMs);
  try {
    const response = await fetchFn(EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        input: [...texts],
        model,
        input_type: config.inputType,
        output_dimension: outputDimension,
        output_dtype: "float",
      }),
      signal: linked.signal,
    });

    if (!response.ok) {
      await discardBody(response);
      throw statusError(response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new EmbeddingProviderError("Embedding service returned an invalid response", {
        code: "invalid_response",
      });
    }
    return vectorsInInputOrder(body, texts.length, outputDimension);
  } catch (error) {
    if (error instanceof EmbeddingProviderError || error instanceof EmbeddingValidationError) throw error;
    if (isAbortError(error) || linked.signal.aborted || config.signal?.aborted) {
      throw new EmbeddingProviderError("Embedding request timed out", { code: "timeout" });
    }
    throw new EmbeddingProviderError("Embedding service is unavailable", { code: "unavailable" });
  } finally {
    linked.dispose();
  }
}

/**
 * Voyage `POST /v1/embeddings`. One vector per input, ordered by the response `index`.
 * The API key stays in the Authorization header. There is no retry and no other provider.
 */
export function createVoyageEmbedder(config: VoyageEmbedderConfig): EmbeddingProvider {
  const maxBatchSize = Math.min(
    MAX_VOYAGE_EMBED_BATCH_SIZE,
    Math.max(1, config.maxBatchSize ?? DEFAULT_VOYAGE_EMBED_BATCH_SIZE),
  );

  return {
    async embedTexts(texts) {
      assertServer();
      if (texts.length === 0) return [];
      const key = apiKey(config);
      const model = modelFor(config);
      const outputDimension = outputDimensionFor(config);
      const allVectors: number[][] = [];
      for (let start = 0; start < texts.length; start += maxBatchSize) {
        const batch = texts.slice(start, start + maxBatchSize);
        allVectors.push(...(await postEmbedBatch(config, batch, key, model, outputDimension)));
      }
      return allVectors;
    },
  };
}
