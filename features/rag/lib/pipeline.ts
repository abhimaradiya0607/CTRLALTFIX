import type { TemplateFolder } from "../../playground/types/index.ts";
import { embedChangedFiles, type ChunkEmbeddingRecord, type EmbeddingProvider } from "./embed-chunks.ts";
import {
  buildIndexPlan,
  type EmbeddingIndexConfig,
  type IndexedFileRecord,
  type IndexPlanSkip,
} from "./index-plan.ts";
import { selectEligibleFiles } from "./select-files.ts";

export interface IndexUpdate {
  /** Files that were (re)embedded. Includes empty files, which produce no chunk records. */
  embeddedFiles: { path: string; contentHash: string }[];
  /** New chunk records for files that changed; replace any stored chunks for these paths. */
  records: ChunkEmbeddingRecord[];
  /** Files whose stored chunks are still valid. */
  unchanged: IndexPlanSkip[];
  /** Previously indexed paths that should be removed from the index. */
  deletedPaths: string[];
}

/**
 * Indexing entry point: select files -> plan -> chunk + embed -> records.
 * Pure apart from the embedder call; nothing is persisted here. If embedding
 * fails, this throws and the caller should leave the existing index untouched.
 */
export async function buildIndexUpdate(input: {
  tree: TemplateFolder;
  indexedFiles: IndexedFileRecord[];
  embedding: EmbeddingIndexConfig;
  embedder: EmbeddingProvider;
}): Promise<IndexUpdate> {
  const currentFiles = selectEligibleFiles(input.tree);
  const plan = buildIndexPlan({
    currentFiles,
    indexedFiles: input.indexedFiles,
    embedding: input.embedding,
  });

  const records = await embedChangedFiles({
    toEmbed: plan.toEmbed,
    embedding: input.embedding,
    embedder: input.embedder,
  });

  return {
    embeddedFiles: plan.toEmbed.map(({ path, contentHash }) => ({ path, contentHash })),
    records,
    unchanged: plan.toSkip,
    deletedPaths: plan.toDelete,
  };
}
