import type { TemplateFile, TemplateFolder } from "../types";
import { fileLabel } from "./index.ts";

/**
 * Package-manager files that must be read back from the WebContainer.
 * `node_modules` is never part of this set.
 */
export const PACKAGE_MANIFEST_NAMES = [
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "npm-shrinkwrap.json",
  "bun.lock",
] as const;

const MANIFEST_NAMES = new Set<string>(PACKAGE_MANIFEST_NAMES);

/** Lockfiles are replaced as a whole. A line merge would break their checksums. */
const LOCKFILE_NAMES = new Set<string>([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "npm-shrinkwrap.json",
  "bun.lock",
  "bun.lockb",
]);

const GENERATED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".cache",
  ".turbo",
  "out",
  ".output",
  ".vercel",
]);

const PACKAGE_MANAGER_COMMANDS = new Set(["npm", "yarn", "pnpm", "bun"]);

export interface SyncEditorFile {
  id: string;
  content: string;
  originalContent: string;
  hasUnsavedChanges: boolean;
}

export interface EditorWriteDecision {
  content: string;
  /** False when the container already has this text, or a newer copy must stay. */
  write: boolean;
  /**
   * False when the open editor still has an edit that was not written.
   * The returned content is the container text that should be stored.
   */
  editorSaved: boolean;
}

/** Runs file saves and package-manager imports one at a time. */
export function createExclusiveQueue() {
  let tail: Promise<void> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

export function commandMayChangeManifests(command: string): boolean {
  const token = command.trim().split(/\s+/)[0] ?? "";
  const base = token.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  return PACKAGE_MANAGER_COMMANDS.has(base);
}

export function isLockfilePath(filePath: string): boolean {
  return LOCKFILE_NAMES.has(baseName(filePath));
}

export function isGeneratedProjectPath(filePath: string): boolean {
  return filePath.split("/").some((part) => GENERATED_DIRECTORIES.has(part));
}

/** Paths to read after a package manager command, including manifests already in the tree. */
export function manifestPathsIn(tree: TemplateFolder): string[] {
  const paths = new Set<string>(PACKAGE_MANIFEST_NAMES);
  const visit = (folder: TemplateFolder, parents: string[]) => {
    for (const item of folder.items) {
      if ("folderName" in item) {
        if (GENERATED_DIRECTORIES.has(item.folderName)) continue;
        visit(item, [...parents, item.folderName]);
        continue;
      }
      const path = [...parents, fileLabel(item)].join("/");
      if (isGeneratedProjectPath(path) || !MANIFEST_NAMES.has(baseName(path))) continue;
      paths.add(path);
    }
  };
  visit(tree, []);
  return [...paths].sort((a, b) => a.localeCompare(b));
}

export function isMissingContainerFile(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    if ((error as { code: unknown }).code === "ENOENT") return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("ENOENT") || message.toLowerCase().includes("no such file");
}

/**
 * Decides what an editor save may write.
 * The baseline is the text the editor started from, not a later container edit.
 * `disk === null` means the container does not have the file yet.
 */
export function resolveEditorWrite(input: {
  path: string;
  baseline: string;
  editor: string;
  disk: string | null;
}): EditorWriteDecision {
  const { path, baseline, editor, disk } = input;
  if (disk === null) {
    return { content: editor, write: true, editorSaved: true };
  }
  if (disk === editor) {
    return { content: editor, write: false, editorSaved: true };
  }
  if (disk === baseline) {
    return { content: editor, write: true, editorSaved: true };
  }

  // The container moved after the editor loaded this file.
  // A clean buffer can adopt that text. A lockfile is kept whole so its
  // checksums stay aligned with the package manager's package.json.
  if (editor === baseline) {
    return { content: disk, write: false, editorSaved: true };
  }
  if (isLockfilePath(path)) {
    return { content: disk, write: false, editorSaved: false };
  }

  const merged = applyEditorChanges(baseline, editor, disk);
  if (merged !== null) {
    return { content: merged, write: merged !== disk, editorSaved: true };
  }
  return { content: disk, write: false, editorSaved: false };
}

/**
 * Applies editor-only line changes onto a newer container file.
 * Returns null when both sides changed the same lines, so the caller can keep
 * the container file instead of writing the stale editor buffer over it.
 */
/**
 * A content-only preview update must not replace a container file that has
 * moved on since the template snapshot. `disk === null` means the file is absent.
 */
export function shouldWriteContainerFile(input: {
  previous: string | undefined;
  next: string;
  disk: string | null;
}): boolean {
  if (input.disk === null) return true;
  if (input.disk === input.next) return false;
  if (input.previous !== undefined && input.disk !== input.previous) return false;
  return true;
}

export function applyEditorChanges(
  baseline: string,
  editor: string,
  disk: string,
): string | null {
  if (editor === baseline) return disk;
  const baseLines = splitLines(baseline);
  const editorLines = splitLines(editor);
  const diskLines = splitLines(disk);
  const hunks = hunksFromEdits(diffLines(baseLines, editorLines));
  let next = diskLines;
  for (const hunk of hunks) {
    const applied = applyHunk(next, hunk);
    if (!applied) return null;
    next = applied;
  }
  return joinLines(next, disk.endsWith("\n") || editor.endsWith("\n"));
}

export function applyExternalFileContents<T extends SyncEditorFile>(input: {
  tree: TemplateFolder;
  openFiles: readonly T[];
  files: ReadonlyMap<string, string>;
}): { tree: TemplateFolder; openFiles: T[]; changed: boolean } {
  let tree = input.tree;
  let changed = false;
  const accepted = new Map<string, string>();

  for (const [path, content] of input.files) {
    const normalized = path.replace(/^\/+/, "");
    if (!normalized || isGeneratedProjectPath(normalized) || !MANIFEST_NAMES.has(baseName(normalized))) {
      continue;
    }
    if (contentAt(tree, normalized) === content) {
      accepted.set(normalized, content);
      continue;
    }
    tree = upsertFile(tree, normalized, content);
    accepted.set(normalized, content);
    changed = true;
  }

  if (!changed) {
    return { tree: input.tree, openFiles: [...input.openFiles], changed: false };
  }

  const openFiles = input.openFiles.map((file) => {
    const disk = accepted.get(file.id.replace(/^\/+/, ""));
    if (disk === undefined) return file;
    // A dirty tab is a user edit. Leave it so a later save can rebase onto the container text.
    if (file.content !== file.originalContent || file.hasUnsavedChanges) return file;
    if (file.content === disk) return file;
    return {
      ...file,
      content: disk,
      originalContent: disk,
      hasUnsavedChanges: false,
    };
  });

  return { tree, openFiles, changed: true };
}

function baseName(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] ?? filePath;
}

function splitName(fileName: string): { filename: string; fileExtension: string } {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return { filename: fileName, fileExtension: "" };
  return { filename: fileName.slice(0, dot), fileExtension: fileName.slice(dot + 1) };
}

function contentAt(tree: TemplateFolder, filePath: string): string | null {
  const parts = filePath.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) return null;
  let folder = tree;
  for (const part of parts) {
    const next = folder.items.find(
      (item): item is TemplateFolder => "folderName" in item && item.folderName === part,
    );
    if (!next) return null;
    folder = next;
  }
  const file = folder.items.find((item) => !("folderName" in item) && fileLabel(item) === name);
  if (!file || "folderName" in file) return null;
  return typeof file.content === "string" ? file.content : "";
}

function upsertFile(tree: TemplateFolder, filePath: string, content: string): TemplateFolder {
  const parts = filePath.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) return tree;
  const { filename, fileExtension } = splitName(name);
  const clone = JSON.parse(JSON.stringify(tree)) as TemplateFolder;
  let folder = clone;
  for (const part of parts) {
    let next = folder.items.find(
      (item): item is TemplateFolder => "folderName" in item && item.folderName === part,
    );
    if (!next) {
      next = { folderName: part, items: [] };
      folder.items.push(next);
    }
    folder = next;
  }
  const existing = folder.items.find((item) => !("folderName" in item) && fileLabel(item) === name);
  if (existing && !("folderName" in existing)) {
    existing.content = content;
    return clone;
  }
  const created: TemplateFile = { filename, fileExtension, content };
  folder.items.push(created);
  return clone;
}

type LineEdit =
  | { type: "equal"; line: string }
  | { type: "delete"; line: string }
  | { type: "insert"; line: string };

interface Hunk {
  before: string[];
  removed: string[];
  inserted: string[];
  after: string[];
}

function splitLines(value: string): string[] {
  if (value.length === 0) return [];
  const normalized = value.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines.pop();
  return lines;
}

function joinLines(lines: string[], trailingNewline: boolean): string {
  const text = lines.join("\n");
  if (lines.length === 0) return trailingNewline ? "\n" : "";
  return trailingNewline ? `${text}\n` : text;
}

function diffLines(from: string[], to: string[]): LineEdit[] {
  const n = from.length;
  const m = to.length;
  const scores: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      scores[i]![j] =
        from[i] === to[j]
          ? scores[i + 1]![j + 1]! + 1
          : Math.max(scores[i + 1]![j]!, scores[i]![j + 1]!);
    }
  }

  const edits: LineEdit[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (from[i] === to[j]) {
      edits.push({ type: "equal", line: from[i]! });
      i += 1;
      j += 1;
    } else if (scores[i + 1]![j]! >= scores[i]![j + 1]!) {
      edits.push({ type: "delete", line: from[i]! });
      i += 1;
    } else {
      edits.push({ type: "insert", line: to[j]! });
      j += 1;
    }
  }
  while (i < n) edits.push({ type: "delete", line: from[i++]! });
  while (j < m) edits.push({ type: "insert", line: to[j++]! });
  return edits;
}

function hunksFromEdits(edits: LineEdit[]): Hunk[] {
  const hunks: Hunk[] = [];
  let index = 0;
  while (index < edits.length) {
    if (edits[index]?.type === "equal") {
      index += 1;
      continue;
    }
    const changeStart = index;
    while (index < edits.length && edits[index]?.type !== "equal") index += 1;
    const changeEnd = index;
    const before: string[] = [];
    for (
      let cursor = changeStart - 1;
      cursor >= 0 && before.length < 3 && edits[cursor]?.type === "equal";
      cursor -= 1
    ) {
      const edit = edits[cursor];
      if (edit?.type === "equal") before.unshift(edit.line);
    }
    const after: string[] = [];
    while (index < edits.length && edits[index]?.type === "equal" && after.length < 3) {
      const edit = edits[index];
      if (edit?.type === "equal") after.push(edit.line);
      index += 1;
    }
    const removed: string[] = [];
    const inserted: string[] = [];
    for (let cursor = changeStart; cursor < changeEnd; cursor += 1) {
      const edit = edits[cursor];
      if (edit?.type === "delete") removed.push(edit.line);
      if (edit?.type === "insert") inserted.push(edit.line);
    }
    hunks.push({ before, removed, inserted, after });
  }
  return hunks;
}

function applyHunk(lines: string[], hunk: Hunk): string[] | null {
  const pattern = [...hunk.before, ...hunk.removed, ...hunk.after];
  if (pattern.length === 0) {
    return lines.length === 0 ? [...hunk.inserted] : null;
  }
  const at = findSequence(lines, pattern);
  if (at < 0 || findSequence(lines, pattern, at + 1) >= 0) return null;
  const insertAt = at + hunk.before.length;
  return [
    ...lines.slice(0, insertAt),
    ...hunk.inserted,
    ...lines.slice(insertAt + hunk.removed.length),
  ];
}

function findSequence(lines: string[], pattern: string[], from = 0): number {
  if (pattern.length === 0) return -1;
  for (let index = from; index + pattern.length <= lines.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < pattern.length; offset += 1) {
      if (lines[index + offset] !== pattern[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}
