import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TemplateFolder } from "../../playground/lib/path-to-json.ts";
import {
  changedContainerFiles,
  listContainerFiles,
  staleContainerPaths,
  toContainerPath,
} from "./container-files.ts";
import { templateStructureKey } from "./template-structure-key.ts";
import { transformToWebContainerFormat } from "./transformer.ts";

const savedTree: TemplateFolder = {
  folderName: "react",
  items: [
    { filename: "index", fileExtension: "html", content: "<div id=\"app\"></div>\n" },
    {
      folderName: "src",
      items: [
        {
          filename: "App",
          fileExtension: "tsx",
          content: "export default function App() { return <h1>React + TypeScript</h1>; }\n",
        },
      ],
    },
  ],
};

function flattenMountedFiles(
  tree: ReturnType<typeof transformToWebContainerFormat>,
  parent = "",
): Map<string, string> {
  const files = new Map<string, string>();
  for (const [name, node] of Object.entries(tree)) {
    const path = `${parent}/${name}`;
    if ("directory" in node) {
      for (const [childPath, content] of flattenMountedFiles(node.directory, path)) {
        files.set(childPath, content);
      }
    } else if ("contents" in node.file && typeof node.file.contents === "string") {
      files.set(path, node.file.contents);
    }
  }
  return files;
}

describe("container file paths", () => {
  it("uses the same absolute paths as the mounted WebContainer tree", () => {
    assert.deepEqual(
      Object.fromEntries(listContainerFiles(savedTree)),
      Object.fromEntries(flattenMountedFiles(transformToWebContainerFormat(savedTree))),
    );
    assert.equal(listContainerFiles(savedTree).get("/src/App.tsx")?.includes("React + TypeScript"), true);
  });

  it("turns the editor save path into that mounted path", () => {
    // findFilePath returns this relative path for src/App.tsx.
    assert.equal(toContainerPath("src/App.tsx"), "/src/App.tsx");
    assert.equal(listContainerFiles(savedTree).has("/src/App.tsx"), true);
  });

  it("reports only the edited file and does not change the setup key", () => {
    const edited: TemplateFolder = {
      ...savedTree,
      items: [
        savedTree.items[0],
        {
          folderName: "src",
          items: [
            {
              filename: "App",
              fileExtension: "tsx",
              content: "export default function App() { return <h1>Saved</h1>; }\n",
            },
          ],
        },
      ],
    };

    assert.equal(templateStructureKey(savedTree), templateStructureKey(edited));
    assert.deepEqual(changedContainerFiles(listContainerFiles(savedTree), listContainerFiles(edited)), [
      {
        path: "/src/App.tsx",
        content: "export default function App() { return <h1>Saved</h1>; }\n",
      },
    ]);
  });

  it("lists template files the next project does not contain", () => {
    const previous = new Map<string, string>([
      ["/pages/index.js", "pages"],
      ["/pages/old.js", "old"],
      ["/src/App.tsx", "app"],
    ]);
    const next = new Map<string, string>([
      ["/pages/index.js", "pages"],
      ["/src/main.ts", "main"],
    ]);

    assert.deepEqual(staleContainerPaths(previous, next), [
      "/pages/old.js",
      "/src/App.tsx",
    ]);
  });
});
