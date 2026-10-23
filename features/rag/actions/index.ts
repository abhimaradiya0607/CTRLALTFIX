"use server";

import { db } from "@/lib/db";
import { readOwnedPlayground } from "@/features/playground/lib/project-access";
import { selectEmbeddingTarget, VOYAGE_OUTPUT_DIMENSIONS, type VoyageOutputDimension } from "../lib/embedding-target";
import { indexProject, rollbackProjectIndex, type IndexProjectResult, type StoredIndex } from "../lib/index-project";
import { createOllamaEmbedder, resolveOllamaBaseUrl } from "../lib/ollama-embedder";
import { createPrismaIndexStore, createPrismaVectorSearch } from "../lib/prisma-index-store";
import { retrieveProjectContext, type RetrieveResult } from "../lib/retrieve";
import { createVoyageEmbedder } from "../lib/voyage-embedder";

/**
 * Server-side entry point for indexing a project for retrieval.
 * The client sends only the project id. User identity, ownership, the saved file tree,
 * and the embedding provider settings all come from the server.
 */
export async function indexPlayground(playgroundId: string): Promise<IndexProjectResult> {
  return indexProject(playgroundId, {
    async getOwnedProject(id) {
      const access = await readOwnedPlayground(id);
      if (access.decision !== "allowed") return { decision: access.decision };
      return { decision: "allowed", project: { id: access.playground.id, userId: access.playground.userId } };
    },
    async loadSavedTree(id) {
      const saved = await db.templateFile.findUnique({
        where: { playgroundId: id },
        select: { content: true },
      });
      return saved?.content ?? null;
    },
    store: createPrismaIndexStore(db),
    createEmbedder(existing) {
      return configuredEmbedder(existing, "document");
    },
  });
}

/** Restores the saved Ollama manifest after a Voyage publication. One database write, no provider call. */
export async function rollbackPlaygroundIndex(playgroundId: string): Promise<IndexProjectResult> {
  return rollbackProjectIndex(playgroundId, {
    async getOwnedProject(id) {
      const access = await readOwnedPlayground(id);
      if (access.decision !== "allowed") return { decision: access.decision };
      return { decision: "allowed", project: { id: access.playground.id, userId: access.playground.userId } };
    },
    store: createPrismaIndexStore(db),
  });
}

/**
 * Server-side search over a project's committed index.
 * The client sends a project id and a question. The server loads the manifest,
 * embeds the question, and drops any chunk the manifest does not reference.
 */
export async function retrievePlaygroundContext(
  playgroundId: string,
  question: string,
  limit?: number,
): Promise<RetrieveResult> {
  const store = createPrismaIndexStore(db);
  return retrieveProjectContext(playgroundId, question, {
    async getOwnedProject(id) {
      const access = await readOwnedPlayground(id);
      if (access.decision !== "allowed") return { decision: access.decision };
      return { decision: "allowed", project: { id: access.playground.id, userId: access.playground.userId } };
    },
    loadIndex: (id) => store.loadIndex(id),
    createEmbedder(index) {
      return configuredEmbedder(index, "query");
    },
    searcher: createPrismaVectorSearch(db),
  }, limit);
}

function configuredEmbedder(
  stored: StoredIndex | null,
  inputType: "query" | "document",
): { embedder: ReturnType<typeof createOllamaEmbedder> | ReturnType<typeof createVoyageEmbedder>; model: string } {
  const target = selectEmbeddingTarget({
    storedModel: stored?.embeddingModel ?? null,
    storedDimensions: stored?.embeddingDimensions ?? null,
    env: process.env,
  });
  if (!target.ok) throw new Error("Embedding service is not configured");
  if (target.provider === "voyage") {
    const outputDimension = target.outputDimension;
    if (!VOYAGE_OUTPUT_DIMENSIONS.includes(outputDimension as VoyageOutputDimension)) {
      throw new Error("Embedding service is not configured");
    }
    return {
      embedder: createVoyageEmbedder({
        model: target.model,
        inputType,
        outputDimension: outputDimension as VoyageOutputDimension,
        env: process.env,
      }),
      model: target.model,
    };
  }
  // The model comes from the server environment. A stored Ollama project is not retargeted to Voyage.
  return {
    embedder: createOllamaEmbedder({ baseUrl: resolveOllamaBaseUrl(), model: target.model }),
    model: target.model,
  };
}
