/**
 * Chooses the embedder, chunk collection, and Atlas index from the stored model.
 * Dimension is never used to choose an index.
 */

export const DEFAULT_VOYAGE_EMBED_MODEL = "voyage-code-4";
export const DEFAULT_VOYAGE_OUTPUT_DIMENSION = 1024;
export const VOYAGE_OUTPUT_DIMENSIONS = [256, 512, 1024, 2048] as const;
export const OLLAMA_VECTOR_INDEX_NAME = "rag_chunk_vector";
export const VOYAGE_VECTOR_INDEX_NAME = "rag_chunk_vector_voyage";

export type ChunkCollection = "ollama" | "voyage";
export type VoyageOutputDimension = (typeof VOYAGE_OUTPUT_DIMENSIONS)[number];

export type EmbeddingTarget =
  | {
      ok: true;
      provider: "ollama" | "voyage";
      model: string;
      collection: ChunkCollection;
      indexName: string;
      outputDimension: number | null;
    }
  | { ok: false; reason: "not-configured" };

const VOYAGE_MODEL_PATTERN = /^voyage-[A-Za-z0-9][A-Za-z0-9._-]{0,64}$/;

export function isVoyageEmbeddingModel(model: string): boolean {
  return VOYAGE_MODEL_PATTERN.test(model);
}

export function chunkCollectionForModel(model: string): ChunkCollection {
  return isVoyageEmbeddingModel(model) ? "voyage" : "ollama";
}

export function vectorIndexForModel(model: string): string {
  return isVoyageEmbeddingModel(model) ? VOYAGE_VECTOR_INDEX_NAME : OLLAMA_VECTOR_INDEX_NAME;
}

export function resolveVoyageEmbedModel(env: { VOYAGE_EMBED_MODEL?: string }): string {
  const configured = env.VOYAGE_EMBED_MODEL?.trim() ?? "";
  const model = configured.length > 0 ? configured : DEFAULT_VOYAGE_EMBED_MODEL;
  if (!isVoyageEmbeddingModel(model)) {
    throw new Error("VOYAGE_EMBED_MODEL is not a voyage model id");
  }
  return model;
}

export function resolveVoyageOutputDimension(env: { VOYAGE_EMBED_DIMENSIONS?: string }): VoyageOutputDimension {
  const raw = env.VOYAGE_EMBED_DIMENSIONS?.trim() ?? "";
  if (raw.length === 0) return DEFAULT_VOYAGE_OUTPUT_DIMENSION;
  const value = Number(raw);
  if (!VOYAGE_OUTPUT_DIMENSIONS.includes(value as VoyageOutputDimension)) {
    throw new Error("VOYAGE_EMBED_DIMENSIONS is not a supported voyage size");
  }
  return value as VoyageOutputDimension;
}

function voyageKey(env: NodeJS.ProcessEnv): string {
  return env.VOYAGE_API_KEY?.trim() ?? "";
}

function providerFlag(env: NodeJS.ProcessEnv): "ollama" | "voyage" | "invalid" {
  const raw = env.RAG_EMBED_PROVIDER?.trim().toLowerCase() ?? "";
  if (raw.length === 0 || raw === "ollama") return "ollama";
  if (raw === "voyage") return "voyage";
  return "invalid";
}

/**
 * Stored model wins. A project with no index follows RAG_EMBED_PROVIDER, which defaults to Ollama.
 * Voyage is never selected as a fallback after an Ollama project, or the reverse.
 */
export function selectEmbeddingTarget(input: {
  storedModel: string | null;
  storedDimensions: number | null;
  env: NodeJS.ProcessEnv;
}): EmbeddingTarget {
  if (input.storedModel && isVoyageEmbeddingModel(input.storedModel)) {
    if (voyageKey(input.env).length === 0) return { ok: false, reason: "not-configured" };
    const dimensions = input.storedDimensions;
    if (
      dimensions === null ||
      !VOYAGE_OUTPUT_DIMENSIONS.includes(dimensions as VoyageOutputDimension)
    ) {
      return { ok: false, reason: "not-configured" };
    }
    return {
      ok: true,
      provider: "voyage",
      model: input.storedModel,
      collection: "voyage",
      indexName: VOYAGE_VECTOR_INDEX_NAME,
      outputDimension: dimensions,
    };
  }

  if (input.storedModel) {
    const model = input.env.OLLAMA_EMBED_MODEL?.trim() ?? "";
    if (model.length === 0) return { ok: false, reason: "not-configured" };
    return {
      ok: true,
      provider: "ollama",
      model,
      collection: "ollama",
      indexName: OLLAMA_VECTOR_INDEX_NAME,
      outputDimension: null,
    };
  }

  if (providerFlag(input.env) === "invalid") return { ok: false, reason: "not-configured" };
  if (providerFlag(input.env) === "voyage") {
    if (voyageKey(input.env).length === 0) return { ok: false, reason: "not-configured" };
    try {
      return {
        ok: true,
        provider: "voyage",
        model: resolveVoyageEmbedModel({ VOYAGE_EMBED_MODEL: input.env.VOYAGE_EMBED_MODEL }),
        collection: "voyage",
        indexName: VOYAGE_VECTOR_INDEX_NAME,
        outputDimension: resolveVoyageOutputDimension({
          VOYAGE_EMBED_DIMENSIONS: input.env.VOYAGE_EMBED_DIMENSIONS,
        }),
      };
    } catch {
      return { ok: false, reason: "not-configured" };
    }
  }

  const ollamaModel = input.env.OLLAMA_EMBED_MODEL?.trim() ?? "";
  if (ollamaModel.length === 0) return { ok: false, reason: "not-configured" };
  return {
    ok: true,
    provider: "ollama",
    model: ollamaModel,
    collection: "ollama",
    indexName: OLLAMA_VECTOR_INDEX_NAME,
    outputDimension: null,
  };
}
