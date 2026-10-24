import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TemplateFolder } from "../../playground/lib/path-to-json.ts";
import { templateStructureKey } from "./template-structure-key.ts";

const tree: TemplateFolder = {
  folderName: "root",
  items: [
    { filename: "index", fileExtension: "ts", content: "one" },
    {
      folderName: "src",
      items: [{ filename: "app", fileExtension: "tsx", content: "view" }],
    },
  ],
};

describe("templateStructureKey", () => {
  it("ignores file contents and the root folder name", () => {
    const edited: TemplateFolder = {
      folderName: "renamed-root",
      items: [
        {
          folderName: "src",
          items: [{ filename: "app", fileExtension: "tsx", content: "changed" }],
        },
        { filename: "index", fileExtension: "ts", content: "two" },
      ],
    };

    assert.equal(templateStructureKey(tree), templateStructureKey(edited));
  });

  it("changes when a file is added or renamed", () => {
    const added: TemplateFolder = {
      ...tree,
      items: [
        ...tree.items,
        { filename: "extra", fileExtension: "js", content: "" },
      ],
    };
    const renamed: TemplateFolder = {
      folderName: "root",
      items: [
        { filename: "main", fileExtension: "ts", content: "one" },
        tree.items[1],
      ],
    };

    assert.notEqual(templateStructureKey(tree), templateStructureKey(added));
    assert.notEqual(templateStructureKey(tree), templateStructureKey(renamed));
  });

  it("ignores a package-manager lockfile so installing a dependency does not remount", () => {
    const withLock: TemplateFolder = {
      ...tree,
      items: [
        ...tree.items,
        { filename: "package-lock", fileExtension: "json", content: "{}\n" },
      ],
    };
    const lockEdited: TemplateFolder = {
      ...withLock,
      items: [
        ...tree.items,
        { filename: "package-lock", fileExtension: "json", content: "{\"changed\":true}\n" },
      ],
    };

    assert.equal(templateStructureKey(tree), templateStructureKey(withLock));
    assert.equal(templateStructureKey(withLock), templateStructureKey(lockEdited));
  });
});