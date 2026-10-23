import { createHash } from "node:crypto";
import type { SelectedSourceFile } from "./select-files.ts";

export interface EmbeddingIndexConfig {
  model: string;
  dimensions: number;
}

/** One row of file-level metadata from the last successful index. */
export interface IndexedFileRecord {
  path: string;
  contentHash: string;
  embeddingModel: string;
  embeddingDimensions: number;
}

export interface IndexPlanEntry {
  path: string;
  content: string;
  contentHash: string;
}

export interface IndexPlanSkip {
  path: string;
  contentHash: string;
}

export interface IndexPlan {
  toEmbed: IndexPlanEntry[];
  toSkip: IndexPlanSkip[];
  toDelete: string[];
}

export function hashSourceFileContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function sortByPath<T extends { path: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => a.path.localeCompare(b.path));
}

function storedEmbeddingConfig(indexedFiles: IndexedFileRecord[]): EmbeddingIndexConfig | null {
  if (indexedFiles.length === 0) return null;
  const first = indexedFiles[0];
  const model = first.embeddingModel;
  const dimensions = first.embeddingDimensions;
  const consistent = indexedFiles.every(
    (record) => record.embeddingModel === model && record.embeddingDimensions === dimensions,
  );
  if (!consistent) return null;
  return { model, dimensions };
}

/**
 * Compares eligible project files with indexed metadata and returns what to embed, skip, or delete.
 */
export function buildIndexPlan(input: {
  currentFiles: SelectedSourceFile[];
  indexedFiles: IndexedFileRecord[];
  embedding: EmbeddingIndexConfig;
}): IndexPlan {
  const indexedByPath = new Map<string, IndexedFileRecord>();
  for (const record of input.indexedFiles) {
    indexedByPath.set(record.path, record);
  }

  const stored = storedEmbeddingConfig(input.indexedFiles);
  const fullReindex =
    input.indexedFiles.length > 0 &&
    (stored === null || stored.model !== input.embedding.model || stored.dimensions !== input.embedding.dimensions);

  const toEmbed: IndexPlanEntry[] = [];
  const toSkip: IndexPlanSkip[] = [];

  const currentPaths = sortByPath(
    input.currentFiles.map((file) => ({ path: file.path, content: file.content })),
  );

  for (const { path, content } of currentPaths) {
    const contentHash = hashSourceFileContent(content);
    const previous = indexedByPath.get(path);

    if (fullReindex || !previous) {
      toEmbed.push({ path, content, contentHash });
      continue;
    }

    if (
      previous.contentHash !== contentHash ||
      previous.embeddingModel !== input.embedding.model ||
      previous.embeddingDimensions !== input.embedding.dimensions
    ) {
      toEmbed.push({ path, content, contentHash });
      continue;
    }

    toSkip.push({ path, contentHash });
  }

  const currentPathSet = new Set(input.currentFiles.map((file) => file.path));
  const toDelete = [...indexedByPath.keys()]
    .filter((path) => !currentPathSet.has(path))
    .sort((a, b) => a.localeCompare(b));

  return {
    toEmbed: sortByPath(toEmbed),
    toSkip: sortByPath(toSkip),
    toDelete,
  };
}
