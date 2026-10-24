import type { TemplateFile, TemplateFolder } from "../types";
import { resolveEditorWrite } from "./container-sync.ts";
import { fileLabel, findFilePath, updateFileInTree } from "./index.ts";

/** `saveUpdatedCode` returns the upserted row, or `null` when the write did not happen. */
export function isPersistedSave(result: unknown): boolean {
  return result != null;
}

/** The database result and the active project are separate facts. */
export interface TemplateSaveOutcome {
  persisted: boolean;
  current: boolean;
}

export function explorerSaveDecision(
  outcome: TemplateSaveOutcome,
): "continue" | "switched" | "failed" {
  if (!outcome.current) return "switched";
  if (!outcome.persisted) return "failed";
  return "continue";
}

/** The route changed before this save could update the project that is now open. */
export class ProjectNoLongerCurrent extends Error {
  constructor() {
    super("Project changed before the save finished");
    this.name = "ProjectNoLongerCurrent";
  }
}

/**
 * A preview or database save failed.
 * `previewRestored` is false when putting the previous text back also failed.
 * The message stays the original save error.
 */
export class ProjectSaveError extends Error {
  readonly previewRestored: boolean;
  readonly restoreError: unknown;

  constructor(message: string, previewRestored: boolean, restoreError?: unknown) {
    super(message);
    this.name = "ProjectSaveError";
    this.previewRestored = previewRestored;
    this.restoreError = restoreError ?? null;
  }
}

export function saveFailureMessage(error: unknown, label: string): string {
  if (error instanceof ProjectSaveError && !error.previewRestored) {
    return `Failed to save ${label}. The preview could not be restored. Reload the preview before continuing.`;
  }
  return `Failed to save ${label}`;
}

type SaveFile = TemplateFile & { id?: string; originalContent?: string };

interface PlannedWrite {
  path: string;
  nextContent: string;
  previousContent: string;
}

export interface SavedProjectFile {
  id?: string;
  path: string;
  content: string;
  /** False when the editor still holds an edit that was not written. */
  editorSaved: boolean;
  editorAtSave: string;
}

export type ProjectSaveResult =
  | { status: "saved"; tree: TemplateFolder; files: SavedProjectFile[] }
  | { status: "switched"; persisted: boolean };

interface OpenSavedFile {
  id: string;
  content: string;
  originalContent: string;
  hasUnsavedChanges: boolean;
}

/** Applies a finished save to open tabs without dropping keystrokes made while it ran. */
export function editorStateAfterSave<T extends OpenSavedFile>(
  openFiles: readonly T[],
  saved: readonly SavedProjectFile[],
): T[] {
  const byId = new Map(
    saved.flatMap((file) => (file.id ? [[file.id, file] as const] : [])),
  );
  return openFiles.map((file) => {
    const result = byId.get(file.id);
    if (!result?.editorSaved) return file;
    const typedDuringSave = file.content !== result.editorAtSave;
    const content = typedDuringSave ? file.content : result.content;
    return {
      ...file,
      content,
      originalContent: result.content,
      hasUnsavedChanges: content !== result.content,
    };
  });
}

interface RestoreResult {
  previewRestored: boolean;
  restoreError: unknown;
}

interface PlannedSave {
  file: SaveFile;
  path: string;
  editor: string;
  baseline: string;
  previousContent: string;
}

/**
 * Saves the edited files into the project tree, then the database.
 * Preview files are written first so a rejected database save can put the previous
 * text back. Writes stop once the open project is no longer this save's project.
 * When `readFile` is set, a container file that changed after the editor loaded
 * it is not replaced by that stale buffer.
 */
export async function saveFilesToProject(input: {
  tree: TemplateFolder;
  files: SaveFile[];
  saveTree: (tree: TemplateFolder) => Promise<boolean>;
  writeFile?: (path: string, content: string) => Promise<void>;
  readFile?: (path: string) => Promise<string | null>;
  stillCurrent?: () => boolean;
}): Promise<ProjectSaveResult> {
  let nextTree = JSON.parse(JSON.stringify(input.tree)) as TemplateFolder;
  const planned: PlannedSave[] = [];

  for (const file of input.files) {
    const filePath = findFilePath(file, nextTree);
    if (!filePath) {
      throw new Error(`Could not find file path for ${file.filename}.${file.fileExtension}`);
    }
    const previousContent = contentAt(input.tree, filePath);
    planned.push({
      file,
      path: filePath,
      editor: file.content,
      baseline: typeof file.originalContent === "string" ? file.originalContent : previousContent,
      previousContent,
    });
    nextTree = updateFileInTree(nextTree, file, file.content);
  }

  const projectChanged = () => input.stillCurrent !== undefined && !input.stillCurrent();
  const written: PlannedWrite[] = [];
  const outcomes = new Map<string, { content: string; editorSaved: boolean }>();

  if (input.writeFile && !projectChanged()) {
    const writeFile = input.writeFile;
    try {
      for (const file of planned) {
        if (projectChanged()) break;
        const disk = input.readFile ? await input.readFile(file.path) : file.baseline;
        if (projectChanged()) break;
        const decision = resolveEditorWrite({
          path: file.path,
          baseline: file.baseline,
          editor: file.editor,
          disk,
        });
        if (decision.write) {
          await writeFile(file.path, decision.content);
          written.push({
            path: file.path,
            nextContent: decision.content,
            previousContent: disk ?? file.previousContent,
          });
        }
        outcomes.set(file.path, {
          content: decision.content,
          editorSaved: decision.editorSaved,
        });
        nextTree = updateFileInTree(nextTree, file.file, decision.content);
      }
    } catch (error) {
      if (projectChanged()) {
        console.error("Preview write failed after the project changed");
        return { status: "switched", persisted: false };
      }
      const restoration = await restoreWritten(written, writeFile, projectChanged);
      if (projectChanged()) {
        console.error("Project changed while restoring the preview");
        return { status: "switched", persisted: false };
      }
      throw new ProjectSaveError(
        error instanceof Error ? error.message : "Failed to write preview file",
        restoration.previewRestored,
        restoration.restoreError,
      );
    }
  }

  const persisted = await input.saveTree(nextTree);
  if (projectChanged()) {
    return { status: "switched", persisted };
  }
  if (!persisted) {
    const restoration = input.writeFile
      ? await restoreWritten(written, input.writeFile, projectChanged)
      : { previewRestored: true, restoreError: null };
    if (projectChanged()) {
      return { status: "switched", persisted: false };
    }
    throw new ProjectSaveError(
      "Failed to save template data",
      restoration.previewRestored,
      restoration.restoreError,
    );
  }

  return {
    status: "saved",
    tree: nextTree,
    files: planned.map((file) => {
      const outcome = outcomes.get(file.path);
      return {
        id: file.file.id,
        path: file.path,
        content: outcome?.content ?? file.editor,
        editorSaved: outcome?.editorSaved ?? true,
        editorAtSave: file.editor,
      };
    }),
  };
}

function contentAt(tree: TemplateFolder, filePath: string): string {
  const visit = (folder: TemplateFolder, parts: string[]): string | null => {
    for (const item of folder.items) {
      if ("folderName" in item) {
        const found = visit(item, [...parts, item.folderName]);
        if (found !== null) return found;
      } else if ([...parts, fileLabel(item)].join("/") === filePath) {
        return typeof item.content === "string" ? item.content : "";
      }
    }
    return null;
  };
  return visit(tree, []) ?? "";
}

async function restoreWritten(
  written: PlannedWrite[],
  writeFile: (path: string, content: string) => Promise<void>,
  projectChanged: () => boolean,
): Promise<RestoreResult> {
  if (projectChanged()) {
    return { previewRestored: false, restoreError: null };
  }
  try {
    for (let index = written.length - 1; index >= 0; index -= 1) {
      if (projectChanged()) {
        return { previewRestored: false, restoreError: null };
      }
      const file = written[index];
      await writeFile(file.path, file.previousContent);
    }
    return { previewRestored: true, restoreError: null };
  } catch (restoreError) {
    return { previewRestored: false, restoreError };
  }
}
