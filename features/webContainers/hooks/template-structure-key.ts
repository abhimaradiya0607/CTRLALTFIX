import type {
  TemplateFolder,
  TemplateItem,
} from "@/features/playground/lib/path-to-json";

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
