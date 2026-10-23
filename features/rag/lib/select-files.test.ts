import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TemplateFolder } from "../../playground/types/index.ts";
import { selectEligibleFiles } from "./select-files.ts";

const sampleTree: TemplateFolder = {
  folderName: "demo",
  items: [
    {
      folderName: "src",
      items: [
        { filename: "App", fileExtension: "tsx", content: "export const App = 1;\n" },
        { filename: "Button", fileExtension: "tsx", content: "export const Button = 1;\n" },
      ],
    },
    {
      folderName: "lib",
      items: [{ filename: "Button", fileExtension: "ts", content: "export const helper = 1;\n" }],
    },
    { filename: "package", fileExtension: "json", content: '{"name":"demo"}\n' },
    { filename: ".env", fileExtension: "", content: "SECRET=1\n" },
    { filename: "logo", fileExtension: "png", content: "binary\n" },
    {
      folderName: "node_modules",
      items: [{ filename: "leftpad", fileExtension: "js", content: "module.exports = 1;\n" }],
    },
    {
      folderName: "dist",
      items: [{ filename: "bundle", fileExtension: "js", content: "bundled\n" }],
    },
  ],
};

describe("selectEligibleFiles", () => {
  it("keeps nested paths and duplicate filenames in different folders", () => {
    const files = selectEligibleFiles(sampleTree);
    assert.deepEqual(
      files.map((file) => file.path),
      ["lib/Button.ts", "package.json", "src/App.tsx", "src/Button.tsx"],
    );
    assert.equal(files.find((file) => file.path === "src/Button.tsx")?.content.includes("Button"), true);
    assert.equal(files.find((file) => file.path === "lib/Button.ts")?.content.includes("helper"), true);
  });

  it("drops secrets, dependency folders, generated files, and binary files", () => {
    const files = selectEligibleFiles(sampleTree);
    assert.equal(files.some((file) => file.path.includes(".env")), false);
    assert.equal(files.some((file) => file.path.includes("node_modules")), false);
    assert.equal(files.some((file) => file.path.includes("dist/")), false);
    assert.equal(files.some((file) => file.path.endsWith(".png")), false);
  });

  it("does not mutate the input tree", () => {
    const tree = structuredClone(sampleTree);
    const before = structuredClone(tree);
    selectEligibleFiles(tree);
    assert.deepEqual(tree, before);
  });

  it("returns an empty list for a tree with no eligible files", () => {
    const tree: TemplateFolder = {
      folderName: "empty",
      items: [
        { filename: ".env", fileExtension: "local", content: "SECRET=1\n" },
        {
          folderName: "node_modules",
          items: [{ filename: "pkg", fileExtension: "js", content: "x\n" }],
        },
      ],
    };
    assert.deepEqual(selectEligibleFiles(tree), []);
  });
});
