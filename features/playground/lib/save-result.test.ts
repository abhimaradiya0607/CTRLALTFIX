import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TemplateFolder } from "../types";
import {
  ProjectSaveError,
  explorerSaveDecision,
  isPersistedSave,
  saveFailureMessage,
  saveFilesToProject,
} from "./save-result.ts";

function projectTree(): TemplateFolder {
  return {
    folderName: "app",
    items: [
      {
        folderName: "pages",
        items: [{ filename: "index", fileExtension: "js", content: "pages saved" }],
      },
      {
        folderName: "routes",
        items: [{ filename: "index", fileExtension: "js", content: "routes saved" }],
      },
    ],
  };
}

function openFile(id: string, content: string) {
  const filename = "index";
  const fileExtension = "js";
  return { id, filename, fileExtension, content };
}

describe("isPersistedSave", () => {
  it("accepts the upserted row from a successful write", () => {
    assert.equal(isPersistedSave({ id: "template-file-1" }), true);
  });

  it("rejects null from an ownership refusal or a caught database error", () => {
    assert.equal(isPersistedSave(null), false);
  });

  it("rejects a missing result", () => {
    assert.equal(isPersistedSave(undefined), false);
  });
});

describe("saveFilesToProject", () => {
  it("writes the persisted tree and the container together", async () => {
    const tree = projectTree();
    const container = new Map<string, string>([
      ["pages/index.js", "pages saved"],
      ["routes/index.js", "routes saved"],
    ]);
    let persisted: TemplateFolder | null = null;

    const result = await saveFilesToProject({
      tree,
      files: [
        openFile("pages/index.js", "pages next"),
        openFile("routes/index.js", "routes next"),
      ],
      saveTree: async (next) => {
        persisted = next;
        return true;
      },
      writeFile: async (path, content) => {
        container.set(path, content);
      },
    });

    assert.equal(result.status, "saved");
    assert.equal(container.get("pages/index.js"), "pages next");
    assert.equal(container.get("routes/index.js"), "routes next");
    assert.equal(JSON.stringify(persisted).includes("pages next"), true);
    assert.equal(JSON.stringify(persisted).includes("routes next"), true);
    assert.equal(JSON.stringify(tree).includes("pages saved"), true);
    assert.equal(JSON.stringify(tree).includes("pages next"), false);
  });

  it("puts the previous container text back when the database save is rejected", async () => {
    const container = new Map<string, string>([
      ["pages/index.js", "pages saved"],
      ["routes/index.js", "routes saved"],
    ]);

    await assert.rejects(
      () =>
        saveFilesToProject({
          tree: projectTree(),
          files: [
            openFile("pages/index.js", "pages next"),
            openFile("routes/index.js", "routes next"),
          ],
          saveTree: async () => false,
          writeFile: async (path, content) => {
            container.set(path, content);
          },
        }),
      /Failed to save template data/,
    );

    assert.equal(container.get("pages/index.js"), "pages saved");
    assert.equal(container.get("routes/index.js"), "routes saved");
  });

  it("does not leave a partial container when a later preview write fails", async () => {
    const container = new Map<string, string>([
      ["pages/index.js", "pages saved"],
      ["routes/index.js", "routes saved"],
    ]);
    let saveCalls = 0;

    await assert.rejects(
      () =>
        saveFilesToProject({
          tree: projectTree(),
          files: [
            openFile("pages/index.js", "pages next"),
            openFile("routes/index.js", "routes next"),
          ],
          saveTree: async () => {
            saveCalls += 1;
            return true;
          },
          writeFile: async (path, content) => {
            if (path === "routes/index.js" && content === "routes next") {
              throw new Error("preview write failed");
            }
            container.set(path, content);
          },
        }),
      /preview write failed/,
    );

    assert.equal(saveCalls, 0);
    assert.equal(container.get("pages/index.js"), "pages saved");
    assert.equal(container.get("routes/index.js"), "routes saved");
  });

  it("does not write the preview after the project has changed", async () => {
    const container = new Map<string, string>([
      ["pages/index.js", "pages saved"],
      ["routes/index.js", "routes saved"],
    ]);
    let persisted = false;

    const failed = await saveFilesToProject({
      tree: projectTree(),
      files: [
        openFile("pages/index.js", "pages next"),
        openFile("routes/index.js", "routes next"),
      ],
      saveTree: async () => {
        persisted = false;
        return false;
      },
      writeFile: async (path, content) => {
        container.set(path, content);
      },
      stillCurrent: () => false,
    });

    assert.equal(failed.status, "switched");
    if (failed.status === "switched") assert.equal(failed.persisted, false);
    assert.equal(container.get("pages/index.js"), "pages saved");
    assert.equal(container.get("routes/index.js"), "routes saved");

    const saved = await saveFilesToProject({
      tree: projectTree(),
      files: [openFile("pages/index.js", "pages next")],
      saveTree: async () => {
        persisted = true;
        return true;
      },
      writeFile: async (path, content) => {
        container.set(path, content);
      },
      stillCurrent: () => false,
    });

    assert.equal(saved.status, "switched");
    if (saved.status === "switched") assert.equal(saved.persisted, true);
    assert.equal(persisted, true);
    assert.equal(container.get("pages/index.js"), "pages saved");
  });

  it("stops later preview writes after the project changes and still reports the database result", async () => {
    const container = new Map<string, string>([
      ["pages/index.js", "pages saved"],
      ["routes/index.js", "routes saved"],
    ]);
    let current = true;

    const result = await saveFilesToProject({
      tree: projectTree(),
      files: [
        openFile("pages/index.js", "pages next"),
        openFile("routes/index.js", "routes next"),
      ],
      saveTree: async () => false,
      writeFile: async (path, content) => {
        container.set(path, content);
        current = false;
      },
      stillCurrent: () => current,
    });

    assert.equal(result.status, "switched");
    if (result.status === "switched") assert.equal(result.persisted, false);
    assert.equal(container.get("pages/index.js"), "pages next");
    assert.equal(container.get("routes/index.js"), "routes saved");
  });

  it("keeps the original database error when the preview restore also throws", async () => {
    const container = new Map<string, string>([["pages/index.js", "pages saved"]]);

    await assert.rejects(
      () =>
        saveFilesToProject({
          tree: projectTree(),
          files: [openFile("pages/index.js", "pages next")],
          saveTree: async () => false,
          writeFile: async (path, content) => {
            if (content === "pages saved") throw new Error("restore failed");
            container.set(path, content);
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProjectSaveError);
        assert.equal(error.message, "Failed to save template data");
        assert.equal(error.previewRestored, false);
        assert.ok(error.restoreError instanceof Error);
        assert.equal((error.restoreError as Error).message, "restore failed");
        return true;
      },
    );

    assert.equal(container.get("pages/index.js"), "pages next");
  });

  it("keeps the original preview error when the restore write also throws", async () => {
    const container = new Map<string, string>([
      ["pages/index.js", "pages saved"],
      ["routes/index.js", "routes saved"],
    ]);

    await assert.rejects(
      () =>
        saveFilesToProject({
          tree: projectTree(),
          files: [
            openFile("pages/index.js", "pages next"),
            openFile("routes/index.js", "routes next"),
          ],
          saveTree: async () => true,
          writeFile: async (path, content) => {
            if (path === "routes/index.js" && content === "routes next") {
              throw new Error("preview write failed");
            }
            if (content === "pages saved") throw new Error("restore failed");
            container.set(path, content);
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProjectSaveError);
        assert.equal(error.message, "preview write failed");
        assert.equal(error.previewRestored, false);
        assert.ok(error.restoreError instanceof Error);
        assert.equal((error.restoreError as Error).message, "restore failed");
        return true;
      },
    );

    assert.equal(container.get("pages/index.js"), "pages next");
    assert.equal(container.get("routes/index.js"), "routes saved");
  });
});

describe("save failure messages", () => {
  it("separates a project switch from a database failure", () => {
    assert.equal(explorerSaveDecision({ persisted: true, current: false }), "switched");
    assert.equal(explorerSaveDecision({ persisted: false, current: false }), "switched");
    assert.equal(explorerSaveDecision({ persisted: false, current: true }), "failed");
    assert.equal(explorerSaveDecision({ persisted: true, current: true }), "continue");
  });

  it("asks the user to reload the preview when restoration fails", () => {
    const error = new ProjectSaveError("Failed to save template data", false, new Error("restore failed"));
    assert.equal(
      saveFailureMessage(error, "index.js"),
      "Failed to save index.js. The preview could not be restored. Reload the preview before continuing.",
    );
    assert.equal(
      saveFailureMessage(new ProjectSaveError("Failed to save template data", true), "index.js"),
      "Failed to save index.js",
    );
  });
});
