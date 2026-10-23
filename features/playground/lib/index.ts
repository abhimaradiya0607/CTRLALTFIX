import type { TemplateFile, TemplateFolder } from "../types";

type FileWithId = TemplateFile & { id?: string };

export interface OpenEditorFile {
  id: string;
  filename: string;
  fileExtension: string;
  content: string;
  originalContent: string;
  hasUnsavedChanges: boolean;
}

export function fileLabel(file: { filename: string; fileExtension?: string }): string {
  return file.fileExtension ? `${file.filename}.${file.fileExtension}` : file.filename;
}

function joinFilePath(folders: string[], file: { filename: string; fileExtension?: string }): string {
  return [...folders, fileLabel(file)].join("/");
}

/** Calls `visit` for each file. A true result stops the walk. */
function visitFiles(
  folder: TemplateFolder,
  folders: string[],
  visit: (file: TemplateFile, filePath: string) => boolean,
): boolean {
  for (const item of folder.items) {
    if ("folderName" in item) {
      if (visitFiles(item, [...folders, item.folderName], visit)) return true;
      continue;
    }
    if (visit(item, joinFilePath(folders, item))) return true;
  }
  return false;
}

/**
 * Project-relative path of `file` inside `folder`.
 * An open tab's id is that path. The filename is used only when it occurs once.
 */
export function findFilePath(
  file: FileWithId,
  folder: TemplateFolder,
  pathSoFar: string[] = [],
): string | null {
  const tabPath = file.id?.replace(/^\/+/, "") ?? "";
  let exactPath: string | null = null;

  visitFiles(folder, pathSoFar, (item, itemPath) => {
    const sameNode = item === file;
    const sameTab = tabPath.length > 0 && itemPath === tabPath;
    if (!sameNode && !sameTab) return false;
    exactPath = itemPath;
    return true;
  });
  if (exactPath) return exactPath;

  const sameName: string[] = [];
  visitFiles(folder, pathSoFar, (item, itemPath) => {
    if (item.filename === file.filename && item.fileExtension === file.fileExtension) {
      sameName.push(itemPath);
    }
    return false;
  });
  if (sameName.length === 1) return sameName[0];
  return null;
}

export function generateFileId(file: TemplateFile, rootFolder: TemplateFolder): string {
  // findFilePath already includes the filename. Appending it again produced pages/index.html/index.html.
  const path = findFilePath(file, rootFolder)?.replace(/^\/+/, "") ?? "";
  if (path) return path;

  const extension = file.fileExtension?.trim();
  return extension ? `${file.filename}.${extension}` : file.filename;
}

/** Opens `file` as its own tab. A second file with the same name keeps its own path id. */
export function openEditorFile<T extends OpenEditorFile>(
  openFiles: T[],
  file: TemplateFile,
  root: TemplateFolder,
): { openFiles: T[]; activeFileId: string; editorContent: string } {
  const fileId = generateFileId(file, root);
  const existing = openFiles.find((tab) => tab.id === fileId);
  if (existing) {
    return { openFiles, activeFileId: fileId, editorContent: existing.content };
  }

  const content = file.content || "";
  const opened = {
    ...file,
    id: fileId,
    hasUnsavedChanges: false,
    content,
    originalContent: content,
  } as T;

  return {
    openFiles: [...openFiles, opened],
    activeFileId: fileId,
    editorContent: content,
  };
}

export interface EditorTabState<T> {
  openFiles: T[];
  activeFileId: string | null;
  editorContent: string;
}

/** Closes one clean tab. An unsaved tab stays open unless `discardUnsaved` is set. */
export function closeEditorTab<T extends OpenEditorFile>(
  state: EditorTabState<T>,
  fileId: string,
  discardUnsaved = false,
): EditorTabState<T> & { closed: boolean } {
  const file = state.openFiles.find((tab) => tab.id === fileId);
  if (file?.hasUnsavedChanges && !discardUnsaved) {
    return { ...state, closed: false };
  }

  const openFiles = state.openFiles.filter((tab) => tab.id !== fileId);
  if (state.activeFileId !== fileId) {
    return { openFiles, activeFileId: state.activeFileId, editorContent: state.editorContent, closed: true };
  }
  if (openFiles.length === 0) {
    return { openFiles, activeFileId: null, editorContent: "", closed: true };
  }

  const next = openFiles[openFiles.length - 1];
  return { openFiles, activeFileId: next.id, editorContent: next.content, closed: true };
}

/** Clears every tab. Refuses while any tab is unsaved unless `discardUnsaved` is set. */
export function closeAllEditorTabs<T extends { hasUnsavedChanges: boolean }>(
  state: EditorTabState<T>,
  discardUnsaved = false,
): EditorTabState<T> & { closed: boolean } {
  if (!discardUnsaved && state.openFiles.some((file) => file.hasUnsavedChanges)) {
    return { ...state, closed: false };
  }

  return { openFiles: [], activeFileId: null, editorContent: "", closed: true };
}

/** Replaces the contents of the one tree node at `file`'s path. */
export function updateFileInTree(
  tree: TemplateFolder,
  file: FileWithId,
  content: string,
): TemplateFolder {
  const filePath = findFilePath(file, tree);
  if (!filePath) {
    throw new Error(`Could not find file path for ${fileLabel(file)}`);
  }

  const replace = (
    items: TemplateFolder["items"],
    parts: string[],
  ): TemplateFolder["items"] =>
    items.map((item) => {
      if ("folderName" in item) {
        return { ...item, items: replace(item.items, [...parts, item.folderName]) };
      }
      if (joinFilePath(parts, item) !== filePath) return item;
      return { ...item, content };
    });

  return { ...tree, items: replace(tree.items, []) };
}
