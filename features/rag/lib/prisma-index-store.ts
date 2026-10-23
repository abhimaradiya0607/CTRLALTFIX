import type { Prisma, PrismaClient } from "../../../lib/generated/prisma/client.ts";
import { OLLAMA_VECTOR_INDEX_NAME, VOYAGE_VECTOR_INDEX_NAME } from "./embedding-target.ts";
import type { IndexStore, ManifestFile } from "./index-project.ts";
import type { VectorSearchQuery } from "./retrieve.ts";

/**
 * Atlas Vector Search index on the `RagChunk` collection. Prisma cannot create this index.
 * Create it once in Atlas (or with createSearchIndexes). `numDimensions` must equal the
 * indexed model's vector size (`RagIndex.embeddingDimensions`). Similarity is cosine.
 *
 * {
 *   "name": "rag_chunk_vector",
 *   "type": "vectorSearch",
 *   "definition": {
 *     "fields": [
 *       { "type": "vector", "path": "embedding", "numDimensions": <dimensions>, "similarity": "cosine" },
 *       { "type": "filter", "path": "playgroundId" },
 *       { "type": "filter", "path": "path" },
 *       { "type": "filter", "path": "runId" }
 *     ]
 *   }
 * }
 *
 * `path` and `runId` are filter fields so a query can exclude staged and stale runs.
 * Retrieval still drops anything the committed manifest does not list.
 */
export const RAG_VECTOR_INDEX_NAME = OLLAMA_VECTOR_INDEX_NAME;
export const RAG_VOYAGE_VECTOR_INDEX_NAME = VOYAGE_VECTOR_INDEX_NAME;

const VECTOR_OVERFETCH = 4;
const MAX_VECTOR_FETCH = 80;
const MAX_VECTOR_CANDIDATES = 200;

export function vectorSearchBounds(resultLimit: number): { limit: number; numCandidates: number } {
  const limit = Math.min(Math.max(resultLimit, 1) * VECTOR_OVERFETCH, MAX_VECTOR_FETCH);
  const numCandidates = Math.min(Math.max(limit * 10, limit), MAX_VECTOR_CANDIDATES);
  return { limit, numCandidates };
}

/** Aggregation pipeline for one project. The filter is the manifest, not the project id alone. */
export function buildChunkVectorSearchPipeline(input: {
  playgroundId: string;
  queryVector: number[];
  resultLimit: number;
  manifest: Pick<ManifestFile, "path" | "runId">[];
  indexName?: string;
  embeddingModel?: string;
}): Prisma.InputJsonObject[] {
  const bounds = vectorSearchBounds(input.resultLimit);
  const modelFilter = input.embeddingModel ? [{ model: { $eq: input.embeddingModel } }] : [];
  return [
    {
      $vectorSearch: {
        index: input.indexName ?? RAG_VECTOR_INDEX_NAME,
        path: "embedding",
        queryVector: input.queryVector,
        numCandidates: bounds.numCandidates,
        limit: bounds.limit,
        filter: {
          $and: [
            { playgroundId: { $eq: input.playgroundId } },
            ...modelFilter,
            {
              $or: input.manifest.map((file) => ({
                $and: [{ path: { $eq: file.path } }, { runId: { $eq: file.runId } }],
              })),
            },
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        path: 1,
        runId: 1,
        content: 1,
        startLine: 1,
        endLine: 1,
        chunkIndex: 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ];
}

// Chunks carry 1k+ floats each, so keep insert batches small to stay far below MongoDB's 16MB command limit.
const INSERT_BATCH_SIZE = 50;
const DELETE_BATCH_SIZE = 500;

function inBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size));
  }
  return batches;
}

/** Cursor id 0 means MongoDB returned the whole batch. Prisma may wrap that 0 as extended JSON. */
function isExhaustedCursor(id: unknown): boolean {
  if (id === 0 || id === undefined || id === null) return true;
  if (typeof id === "object" && id !== null && "$numberLong" in id) {
    return (id as { $numberLong?: unknown }).$numberLong === "0";
  }
  return false;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

function manifestFiles(files: ManifestFile[]) {
  return files.map(({ path, contentHash, runId }) => ({ path, contentHash, runId }));
}

/**
 * Prisma implementation of IndexStore. Contains no business rules; those live in index-project.ts.
 * The client is injected so integration tests can point it at a throwaway database.
 */
export function createPrismaIndexStore(db: PrismaClient): IndexStore {
  return {
    async loadIndex(playgroundId) {
      const row = await db.ragIndex.findUnique({
        where: { playgroundId },
        select: {
          version: true,
          embeddingModel: true,
          embeddingDimensions: true,
          files: true,
          previousEmbeddingModel: true,
          previousEmbeddingDimensions: true,
          previousFiles: true,
        },
      });
      if (!row) return null;
      return {
        version: row.version,
        embeddingModel: row.embeddingModel,
        embeddingDimensions: row.embeddingDimensions,
        files: row.files,
        previousEmbeddingModel: row.previousEmbeddingModel,
        previousEmbeddingDimensions: row.previousEmbeddingDimensions,
        previousFiles: row.previousFiles ?? [],
      };
    },

    async insertChunks({ playgroundId, userId, runId, baseVersion, records, collection = "ollama" }) {
      for (const batch of inBatches(records, INSERT_BATCH_SIZE)) {
        const data = batch.map((record) => ({
          playgroundId,
          userId,
          runId,
          baseVersion,
          path: record.path,
          chunkIndex: record.chunkIndex,
          startLine: record.startLine,
          endLine: record.endLine,
          content: record.content,
          fileHash: record.fileHash,
          embedding: record.embedding,
          model: record.model,
          dimensions: record.dimensions,
        }));
        if (collection === "voyage") await db.ragChunkVoyage.createMany({ data });
        else await db.ragChunk.createMany({ data });
      }
    },

    async commitIndex({ playgroundId, userId, expectedVersion, embedding, files, previous }) {
      const data = {
        userId,
        embeddingModel: embedding.model,
        embeddingDimensions: embedding.dimensions,
      };
      const savedPrevious =
        previous === undefined
          ? {}
          : previous === null
            ? {
                previousEmbeddingModel: null,
                previousEmbeddingDimensions: null,
                previousFiles: [],
              }
            : {
                previousEmbeddingModel: previous.model,
                previousEmbeddingDimensions: previous.dimensions,
                previousFiles: manifestFiles(previous.files),
              };

      if (expectedVersion === null) {
        try {
          await db.ragIndex.create({
            data: {
              ...data,
              previousEmbeddingModel: previous ? previous.model : null,
              previousEmbeddingDimensions: previous ? previous.dimensions : null,
              previousFiles: previous ? manifestFiles(previous.files) : [],
              playgroundId,
              files: manifestFiles(files),
            },
          });
          return true;
        } catch (error) {
          // The unique playgroundId index rejects a second first-time commit.
          if (isUniqueViolation(error)) return false;
          throw error;
        }
      }

      // Version-guarded update as ONE MongoDB command. Prisma's updateMany is not suitable here:
      // it first looks up matching _ids and then updates by _id alone (verified from the real
      // query log), so the version check would not be evaluated at write time. A raw `update`
      // evaluates `q` and applies `u` atomically on the single matching document.
      // "RagIndex" and the field names mirror prisma/schema.prisma.
      const result = (await db.$runCommandRaw({
        update: "RagIndex",
        updates: [
          {
            q: { playgroundId, version: expectedVersion },
            u: {
              $set: {
                ...data,
                ...savedPrevious,
                files: manifestFiles(files),
                updatedAt: { $date: new Date().toISOString() },
              },
              $inc: { version: 1 },
            },
            multi: false,
          },
        ],
      })) as { ok?: number; n?: number; writeErrors?: unknown[] };

      if (result.ok !== 1 || (result.writeErrors?.length ?? 0) > 0) {
        throw new Error("RagIndex version-guarded update failed");
      }
      return result.n === 1;
    },

    async rollbackIndex({ playgroundId, expectedVersion, embedding, files }) {
      const result = (await db.$runCommandRaw({
        update: "RagIndex",
        updates: [
          {
            q: { playgroundId, version: expectedVersion },
            u: {
              $set: {
                embeddingModel: embedding.model,
                embeddingDimensions: embedding.dimensions,
                files: manifestFiles(files),
                updatedAt: { $date: new Date().toISOString() },
              },
              $unset: {
                previousEmbeddingModel: "",
                previousEmbeddingDimensions: "",
                previousFiles: "",
              },
              $inc: { version: 1 },
            },
            multi: false,
          },
        ],
      })) as { ok?: number; n?: number; writeErrors?: unknown[] };

      if (result.ok !== 1 || (result.writeErrors?.length ?? 0) > 0) {
        throw new Error("RagIndex version-guarded update failed");
      }
      return result.n === 1;
    },

    async listChunkRefs(playgroundId, collection = "ollama") {
      // Deliberately excludes content and embedding so this stays cheap.
      const query = {
        where: { playgroundId },
        select: { id: true, path: true, runId: true, baseVersion: true },
      } as const;
      if (collection === "voyage") return db.ragChunkVoyage.findMany(query);
      return db.ragChunk.findMany(query);
    },

    async deleteChunks(ids) {
      for (const batch of inBatches(ids, DELETE_BATCH_SIZE)) {
        await db.ragChunk.deleteMany({ where: { id: { in: batch } } });
        await db.ragChunkVoyage.deleteMany({ where: { id: { in: batch } } });
      }
    },

    async deleteRunChunks(playgroundId, runId, collection = "ollama") {
      const where = { playgroundId, runId };
      if (collection === "voyage") await db.ragChunkVoyage.deleteMany({ where });
      else await db.ragChunk.deleteMany({ where });
    },
  };
}

/**
 * Runs the vector search aggregation. Returns the raw hit list for `retrieve.ts` to validate
 * and to check against the manifest again. Throws on any command or cursor problem.
 */
export function createPrismaVectorSearch(db: PrismaClient): {
  search(input: VectorSearchQuery): Promise<unknown>;
} {
  return {
    async search(input) {
      if (input.manifest.length === 0) return [];
      const pipeline = buildChunkVectorSearchPipeline({
        playgroundId: input.playgroundId,
        queryVector: input.queryVector,
        resultLimit: input.limit,
        manifest: input.manifest,
        indexName: input.indexName,
        embeddingModel: input.embeddingModel,
      });
      const bounds = vectorSearchBounds(input.limit);
      const result = (await db.$runCommandRaw({
        aggregate: input.collection === "voyage" ? "RagChunkVoyage" : "RagChunk",
        pipeline,
        cursor: { batchSize: bounds.limit },
      })) as { cursor?: { id?: unknown; firstBatch?: unknown } };

      const exhausted = isExhaustedCursor(result.cursor?.id);
      if (!exhausted) {
        throw new Error("Vector search returned more rows than requested");
      }
      if (!Array.isArray(result.cursor?.firstBatch)) {
        throw new Error("Vector search response had no result batch");
      }
      return result.cursor.firstBatch;
    },
  };
}
