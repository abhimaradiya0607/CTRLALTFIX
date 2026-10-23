import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { assessEditTarget } from "../../ai-chat/lib/edit-proposal.ts";
import { collectProjectFiles } from "../../ai-chat/lib/project-context.ts";
import { generateFileId, openEditorFile, updateFileInTree } from "./index.ts";
import { scanTemplateDirectory, type TemplateFile, type TemplateFolder } from "./path-to-json.ts";

function findSavedFile(
  folder: TemplateFolder,
  folders: string[],
  filename: string,
  fileExtension: string,
): TemplateFile {
  let current = folder;
  for (const name of folders) {
    const next = current.items.find((item) => "folderName" in item && item.folderName === name);
    assert.ok(next && "folderName" in next, `missing folder ${name}`);
    current = next;
  }
  const file = current.items.find(
    (item) => "filename" in item && item.filename === filename && item.fileExtension === fileExtension,
  );
  assert.ok(file && "filename" in file, `missing ${folders.join("/")}/${filename}.${fileExtension}`);
  return file;
}

describe("generateFileId", () => {
  it("matches the saved express-simple path for pages/index.html", async () => {
    const tree = await scanTemplateDirectory(
      path.join(process.cwd(), "starters/express-simple"),
    );
    const page = findSavedFile(tree, ["pages"], "index", "html");
    const script = findSavedFile(tree, [], "index", "js");
    const saved = collectProjectFiles(tree).map((file) => file.path);

    assert.equal(generateFileId(page, tree), "pages/index.html");
    assert.equal(generateFileId(script, tree), "index.js");
    assert.equal(saved.includes("pages/index.html"), true);
    assert.equal(saved.includes("index.js"), true);
    assert.equal(
      assessEditTarget({ path: generateFileId(page, tree), baseContent: page.content, tree }),
      "ok",
    );
    assert.equal(
      assessEditTarget({
        path: "pages/index.html/index.html",
        baseContent: page.content,
        tree,
      }),
      "missing",
    );
  });
});

function duplicateNameTree(): TemplateFolder {
  return {
    folderName: "app",
    items: [
      {
        folderName: "pages",
        items: [{ filename: "index", fileExtension: "js", content: "pages file" }],
      },
      {
        folderName: "routes",
        items: [{ filename: "index", fileExtension: "js", content: "routes file" }],
      },
    ],
  };
}

describe("files with the same name in different directories", () => {
  it("gives each file its own path and its own tab", () => {
    const tree = duplicateNameTree();
    const pagesFile = findSavedFile(tree, ["pages"], "index", "js");
    const routesFile = findSavedFile(tree, ["routes"], "index", "js");

    assert.equal(generateFileId(pagesFile, tree), "pages/index.js");
    assert.equal(generateFileId(routesFile, tree), "routes/index.js");

    const first = openEditorFile([], pagesFile, tree);
    const second = openEditorFile(first.openFiles, routesFile, tree);

    assert.equal(second.activeFileId, "routes/index.js");
    assert.deepEqual(
      second.openFiles.map((tab) => tab.id),
      ["pages/index.js", "routes/index.js"],
    );
    assert.equal(second.openFiles[0].content, "pages file");
    assert.equal(second.openFiles[1].content, "routes file");

    const backToFirst = openEditorFile(second.openFiles, pagesFile, tree);
    assert.equal(backToFirst.activeFileId, "pages/index.js");
    assert.equal(backToFirst.openFiles.length, 2);
    assert.equal(backToFirst.openFiles[1].content, "routes file");
    assert.equal(backToFirst.editorContent, "pages file");
  });

  it("saves the second file without changing the first tree node", () => {
    const tree = duplicateNameTree();
    const pagesFile = findSavedFile(tree, ["pages"], "index", "js");
    const routesFile = findSavedFile(tree, ["routes"], "index", "js");
    const opened = openEditorFile(
      openEditorFile([], pagesFile, tree).openFiles,
      routesFile,
      tree,
    );
    const routesTab = opened.openFiles[1];

    const saved = updateFileInTree(tree, routesTab, "routes edited");

    assert.equal(findSavedFile(saved, ["routes"], "index", "js").content, "routes edited");
    assert.equal(findSavedFile(saved, ["pages"], "index", "js").content, "pages file");
    assert.equal(findSavedFile(tree, ["routes"], "index", "js").content, "routes file");
  });
});
