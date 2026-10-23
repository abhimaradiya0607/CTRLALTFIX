import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  projectSwitchPatch,
  shouldApplyLoadedTree,
} from "./project-switch.ts";

describe("projectSwitchPatch", () => {
  it("clears tabs, the active file, and the tree when the project id changes", () => {
    assert.deepEqual(projectSwitchPatch("project-a", "project-b"), {
      playgroundId: "project-b",
      templateData: null,
      openFiles: [],
      activeFileId: null,
      editorContent: "",
    });
  });

  it("does nothing when the same project stays active", () => {
    assert.equal(projectSwitchPatch("project-a", "project-a"), null);
  });

  it("does nothing for an empty route id", () => {
    assert.equal(projectSwitchPatch("project-a", ""), null);
  });
});

describe("shouldApplyLoadedTree", () => {
  it("applies the loaded tree after a switch once that project has no tabs", () => {
    assert.equal(
      shouldApplyLoadedTree({
        routeId: "project-b",
        storeId: "project-b",
        openFileCount: 0,
        hasTree: true,
      }),
      true,
    );
  });

  it("does not apply a tree while another project's tabs are still open", () => {
    assert.equal(
      shouldApplyLoadedTree({
        routeId: "project-b",
        storeId: "project-a",
        openFileCount: 2,
        hasTree: true,
      }),
      false,
    );
  });

  it("does not replace the tree during ordinary editing of the same project", () => {
    assert.equal(
      shouldApplyLoadedTree({
        routeId: "project-a",
        storeId: "project-a",
        openFileCount: 1,
        hasTree: true,
      }),
      false,
    );
  });

  it("does not apply a missing tree", () => {
    assert.equal(
      shouldApplyLoadedTree({
        routeId: "project-b",
        storeId: "project-b",
        openFileCount: 0,
        hasTree: false,
      }),
      false,
    );
  });
});
