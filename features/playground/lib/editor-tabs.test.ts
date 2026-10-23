import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { closeAllEditorTabs, closeEditorTab, openEditorFile } from "./index.ts";
import { projectSwitchPatch } from "./project-switch.ts";
import type { TemplateFile, TemplateFolder } from "./path-to-json.ts";

function tab(id: string, content: string, hasUnsavedChanges: boolean) {
  const [filename, fileExtension] = id.split(".");
  return {
    id,
    filename,
    fileExtension,
    content,
    originalContent: hasUnsavedChanges ? "saved" : content,
    hasUnsavedChanges,
  };
}

const tree: TemplateFolder = {
  folderName: "app",
  items: [
    { filename: "app", fileExtension: "js", content: "app" },
    { filename: "main", fileExtension: "js", content: "main" },
  ],
};

describe("editor tabs", () => {
  it("closes every clean tab and clears the editor", () => {
    const state = {
      openFiles: [tab("app.js", "app", false), tab("main.js", "main", false)],
      activeFileId: "main.js",
      editorContent: "main",
    };

    const next = closeAllEditorTabs(state);

    assert.equal(next.closed, true);
    assert.deepEqual(next.openFiles, []);
    assert.equal(next.activeFileId, null);
    assert.equal(next.editorContent, "");
  });

  it("closes a clean tab and keeps the other tab active", () => {
    const state = {
      openFiles: [tab("app.js", "app", false), tab("main.js", "main", false)],
      activeFileId: "main.js",
      editorContent: "main",
    };

    const next = closeEditorTab(state, "app.js");

    assert.equal(next.closed, true);
    assert.deepEqual(next.openFiles.map((file) => file.id), ["main.js"]);
    assert.equal(next.activeFileId, "main.js");
    assert.equal(next.editorContent, "main");

    const closedActive = closeEditorTab(state, "main.js");
    assert.equal(closedActive.closed, true);
    assert.deepEqual(closedActive.openFiles.map((file) => file.id), ["app.js"]);
    assert.equal(closedActive.activeFileId, "app.js");
    assert.equal(closedActive.editorContent, "app");
  });

  it("keeps an unsaved tab open unless the close is confirmed", () => {
    const state = {
      openFiles: [tab("app.js", "draft", true), tab("main.js", "main", false)],
      activeFileId: "app.js",
      editorContent: "draft",
    };

    const refused = closeEditorTab(state, "app.js");
    assert.equal(refused.closed, false);
    assert.equal(refused.openFiles[0].content, "draft");
    assert.equal(refused.activeFileId, "app.js");
    assert.equal(refused.editorContent, "draft");

    const discarded = closeEditorTab(state, "app.js", true);
    assert.equal(discarded.closed, true);
    assert.deepEqual(discarded.openFiles.map((file) => file.id), ["main.js"]);
    assert.equal(discarded.activeFileId, "main.js");
    assert.equal(discarded.editorContent, "main");
  });

  it("does not clear tabs when Close All is refused", () => {
    const state = {
      openFiles: [tab("app.js", "draft", true), tab("main.js", "main", false)],
      activeFileId: "main.js",
      editorContent: "main",
    };

    const next = closeAllEditorTabs(state);
    assert.equal(next.closed, false);
    assert.equal(next.openFiles.length, 2);
    assert.equal(next.activeFileId, "main.js");
    assert.equal(next.editorContent, "main");

    const discarded = closeAllEditorTabs(state, true);
    assert.equal(discarded.closed, true);
    assert.deepEqual(discarded.openFiles, []);
    assert.equal(discarded.activeFileId, null);
    assert.equal(discarded.editorContent, "");
  });

  it("switches back to an open tab without dropping the other file", () => {
    const app = tree.items[0] as TemplateFile;
    const main = tree.items[1] as TemplateFile;
    const first = openEditorFile([], app, tree);
    const second = openEditorFile(first.openFiles, main, tree);
    const back = openEditorFile(second.openFiles, app, tree);

    assert.equal(back.activeFileId, "app.js");
    assert.deepEqual(back.openFiles.map((file) => file.id), ["app.js", "main.js"]);
    assert.equal(back.editorContent, "app");
  });

  it("still clears editor state when the project changes", () => {
    assert.deepEqual(projectSwitchPatch("project-a", "project-b"), {
      playgroundId: "project-b",
      templateData: null,
      openFiles: [],
      activeFileId: null,
      editorContent: "",
    });
  });

  it("wires both Close All buttons to the store action", () => {
    const store = readFileSync(
      new URL("../hooks/useFileExplorer.tsx", import.meta.url),
      "utf8",
    );
    const page = readFileSync(
      new URL("../../../app/playground/[id]/page.tsx", import.meta.url),
      "utf8",
    );

    assert.equal(store.includes("closeAllFiles: () => {"), true);
    assert.equal(page.includes("onClick={closeAllFiles}"), true);
    assert.equal((page.match(/onClick=\{closeAllFiles\}/g) ?? []).length, 2);
  });
});
