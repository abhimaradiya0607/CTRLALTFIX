import type {
  TemplateFolder,
  TemplateItem,
} from "@/features/playground/lib/path-to-json";

export interface ContainerFileWrite {
  path: string;
  content: string;
}

function isFolder(item: TemplateItem): item is TemplateFolder {
  return (
    "folderName" in item &&
    "items" in item &&
    Boolean(item.folderName) &&
    Boolean(item.items)
  );
}

function fileName(item: TemplateItem): string {
  if ("fileExtension" in item && item.fileExtension) {
    return `${item.filename}.${item.fileExtension}`;
  }
  if ("folderName" in item) {
    return item.folderName;
  }
  return item.filename;
}

/** WebContainer fs paths are absolute from the mounted project root. */
export function toContainerPath(path: string): string {
  const normalized = path
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
  const relative = normalized.replace(/^\/+/, "");
  if (!relative) {
    throw new Error("Missing container file path");
  }
  return `/${relative}`;
}

export function listContainerFiles(
  template: TemplateFolder,
): Map<string, string> {
  const files = new Map<string, string>();

  const visit = (item: TemplateItem, parent: string) => {
    if (isFolder(item)) {
      const next = parent ? `${parent}/${item.folderName}` : item.folderName;
      for (const child of item.items) {
        visit(child, next);
      }
      return;
    }

    const name = fileName(item);
    files.set(toContainerPath(parent ? `${parent}/${name}` : name), item.content);
  };

  for (const item of template.items) {
    visit(item, "");
  }

  return files;
}

/**
 * Template files from the previous project that are not in the next tree.
 * Runtime files such as node_modules are not in these maps, so they are left alone.
 */
export function staleContainerPaths(
  previous: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): string[] {
  const removed: string[] = [];
  for (const path of previous.keys()) {
    if (!next.has(path)) removed.push(path);
  }
  removed.sort((a, b) => a.localeCompare(b));
  return removed;
}

export function changedContainerFiles(
  previous: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): ContainerFileWrite[] {
  const changes: ContainerFileWrite[] = [];
  for (const [path, content] of next) {
    if (previous.get(path) !== content) {
      changes.push({ path, content });
    }
  }
  changes.sort((a, b) => a.path.localeCompare(b.path));
  return changes;
}
