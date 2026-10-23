import { collectProjectFiles, type ProjectSourceFile } from "../../ai-chat/lib/project-context.ts";
import type { TemplateFolder } from "../../playground/types/index.ts";

export type SelectedSourceFile = ProjectSourceFile;

/**
 * Eligible saved-project files for indexing, sorted by path.
 * Reuses the chat context rules so secrets (.env), dependencies, build output,
 * and binary files are excluded in exactly one place.
 */
export function selectEligibleFiles(tree: TemplateFolder): SelectedSourceFile[] {
  return collectProjectFiles(tree);
}
