import type {
  TemplateFolder,
  TemplateItem,
} from "@/features/playground/lib/path-to-json";

/**
 * Lockfiles are written by the package manager after mount.
 * Treating them as structure would remount the preview and run install again.
 */
const PACKAGE_MANAGER_LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "npm-shrinkwrap.json",
  "bun.lock",
  "bun.lockb",
]);

function visit(item: TemplateItem, parent: string, paths: string[]) {
  if ("folderName" in item && "items" in item) {
    const folderPath = parent ? `${parent}/${item.folderName}` : item.folderName;
    paths.push(`dir:${folderPath}`);
    for (const child of item.items) {
      visit(child, folderPath, paths);
    }
    return;
  }

  const fileName =
    "fileExtension" in item && item.fileExtension
      ? `${item.filename}.${item.fileExtension}`
      : item.filename;
  if (PACKAGE_MANAGER_LOCKFILES.has(fileName)) return;
  paths.push(`file:${parent ? `${parent}/${fileName}` : fileName}`);
}

/** Paths only. File contents are written with `writeFileSync` and do not restart setup. */
export function templateStructureKey(template: TemplateFolder): string {
  const paths: string[] = [];
  for (const item of template.items) {
    visit(item, "", paths);
  }
  paths.sort();
  return paths.join("\n");
}
