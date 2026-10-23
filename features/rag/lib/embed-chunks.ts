import { chunkSource, type SourceChunk } from "./chunk-source.ts";
import type { EmbeddingIndexConfig, IndexPlanEntry } from "./index-plan.ts";

export interface EmbeddingProvider {
  /** Returns one vector per input string, in the same order. */
  embedTexts(texts: readonly string[]): Promise<number[][]>;
}

export interface ChunkEmbeddingRecord {
  path: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  content: string;
  fileHash: string;
  embedding: number[];
  model: string;
  dimensions: number;
}

export class EmbeddingValidationError extends Error {
  readonly name = "EmbeddingValidationError";
}

export type EmbeddingFailureCode =
  | "not_configured"
  | "rate_limited"
  | "unavailable"
  | "invalid_response"
  | "timeout";

export class EmbeddingProviderError extends Error {
  readonly name = "EmbeddingProviderError";
  readonly code: EmbeddingFailureCode;

  constructor(message: string, options?: ErrorOptions & { code?: EmbeddingFailureCode }) {
    super(message, options);
    this.code = options?.code ?? "unavailable";
  }
}

/**
 * Validates provider output before pairing vectors with chunks.
 * Takes `unknown` items because the data comes from an external service.
 */
export function validateEmbeddingVectors(
  vectors: readonly unknown[],
  expectedCount: number,
): { dimensions: number } {
  if (vectors.length !== expectedCount) {
    throw new EmbeddingValidationError(
      `Expected ${expectedCount} embedding vectors but received ${vectors.length}`,
    );
  }

  if (expectedCount === 0) {
    return { dimensions: 0 };
  }

  let dimensions: number | null = null;

  for (let index = 0; index < vectors.length; index += 1) {
    const vector = vectors[index];
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new EmbeddingValidationError(`Embedding vector at index ${index} is empty or not an array`);
    }

    if (dimensions === null) {
      dimensions = vector.length;
    } else if (vector.length !== dimensions) {
      throw new EmbeddingValidationError(
        `Inconsistent embedding dimensions at index ${index}: expected ${dimensions}, got ${vector.length}`,
      );
    }

    for (let dim = 0; dim < vector.length; dim += 1) {
      const value = vector[dim];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new EmbeddingValidationError(
          `Non-finite embedding value at vector ${index}, dimension ${dim}`,
        );
      }
    }
  }

  return { dimensions: dimensions ?? 0 };
}

interface ChunkWithHash extends SourceChunk {
  fileHash: string;
}

function buildChunksFromPlan(toEmbed: readonly IndexPlanEntry[]): ChunkWithHash[] {
  // buildIndexPlan already sorts; re-sorting keeps output deterministic for any caller.
  const ordered = [...toEmbed].sort((a, b) => a.path.localeCompare(b.path));
  const chunks: ChunkWithHash[] = [];

  for (const file of ordered) {
    const fileChunks = chunkSource(file.path, file.content);
    for (const chunk of fileChunks) {
      chunks.push({ ...chunk, fileHash: file.contentHash });
    }
  }

  return chunks;
}

/**
 * Chunks `toEmbed` files and embeds them via the injectable provider.
 * Does not call the provider when there are zero chunks.
 */
export async function embedChangedFiles(input: {
  toEmbed: readonly IndexPlanEntry[];
  embedding: EmbeddingIndexConfig;
  embedder: EmbeddingProvider;
}): Promise<ChunkEmbeddingRecord[]> {
  const chunks = buildChunksFromPlan(input.toEmbed);
  if (chunks.length === 0) {
    return [];
  }

  const texts = chunks.map((chunk) => chunk.content);
  let vectors: number[][];
  try {
    vectors = await input.embedder.embedTexts(texts);
  } catch (error) {
    if (error instanceof EmbeddingValidationError || error instanceof EmbeddingProviderError) {
      throw error;
    }
    throw new EmbeddingProviderError(
      error instanceof Error ? error.message : "Embedding provider failed",
      { cause: error },
    );
  }

  const { dimensions } = validateEmbeddingVectors(vectors, texts.length);

  // dimensions 0 means "not known yet" (first index with a new model); the response then defines it.
  if (input.embedding.dimensions > 0 && dimensions !== input.embedding.dimensions) {
    throw new EmbeddingValidationError(
      `Embedding dimensions ${dimensions} do not match configured dimensions ${input.embedding.dimensions}`,
    );
  }

  return chunks.map((chunk, index) => ({
    path: chunk.path,
    chunkIndex: chunk.chunkIndex,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    content: chunk.content,
    fileHash: chunk.fileHash,
    embedding: [...vectors[index]!],
    model: input.embedding.model,
    dimensions,
  }));
}
