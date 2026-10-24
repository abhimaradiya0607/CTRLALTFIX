import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TemplateFolder } from "../types";
import {
  applyExternalFileContents,
  commandMayChangeManifests,
  createExclusiveQueue,
  isGeneratedProjectPath,
  manifestPathsIn,
  resolveEditorWrite,
  shouldWriteContainerFile,
} from "./container-sync.ts";

const baseline = `{
  "name": "react-starter",
  "private": true,
  "version": "0.0.0",
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
`;

const installed = `{
  "name": "react-starter",
  "private": true,
  "version": "0.0.0",
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.18.4"
  }
}
`;

const edited = `{
  "name": "react-starter",
  "private": true,
  "ctrlaltfixTest": true,
  "version": "0.0.0",
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
`;

function reactTree(packageJson = baseline): TemplateFolder {
  return {
    folderName: "react",
    items: [
      { filename: "package", fileExtension: "json", content: packageJson },
      { filename: "App", fileExtension: "tsx", content: "export const App = 1;\n" },
    ],
  };
}

describe("package manager snapshots", () => {
  it("recognizes install commands and ignores file reads", () => {
    assert.equal(commandMayChangeManifests("npm install react-router-dom"), true);
    assert.equal(commandMayChangeManifests("pnpm add zod"), true);
    assert.equal(commandMayChangeManifests("yarn add left-pad"), true);
    assert.equal(commandMayChangeManifests("bun install"), true);
    assert.equal(commandMayChangeManifests("cat package.json"), false);
    assert.equal(commandMayChangeManifests("ls"), false);
  });

  it("reads root manifests and nested ones already in the project, never node_modules", () => {
    const tree: TemplateFolder = {
      folderName: "app",
      items: [
        { filename: "package", fileExtension: "json", content: "{}\n" },
        {
          folderName: "node_modules",
          items: [{ filename: "package", fileExtension: "json", content: "{}\n" }],
        },
        {
          folderName: "apps",
          items: [
            {
              folderName: "web",
              items: [{ filename: "package", fileExtension: "json", content: "{}\n" }],
            },
          ],
        },
      ],
    };

    assert.deepEqual(manifestPathsIn(tree), [
      "apps/web/package.json",
      "bun.lock",
      "npm-shrinkwrap.json",
      "package-lock.json",
      "package.json",
      "pnpm-lock.yaml",
      "yarn.lock",
    ]);
    assert.equal(isGeneratedProjectPath("node_modules/react/package.json"), true);
    assert.equal(manifestPathsIn(tree).some((path) => path.includes("node_modules")), false);
  });

  it("stores the installed package.json and lockfile together and refreshes a clean editor", () => {
    const lockfile = '{"lockfileVersion":3,"packages":{"react-router-dom":{}}}\n';
    const applied = applyExternalFileContents({
      tree: reactTree(),
      openFiles: [
        {
          id: "package.json",
          content: baseline,
          originalContent: baseline,
          hasUnsavedChanges: false,
        },
        {
          id: "App.tsx",
          content: "export const App = 1;\n",
          originalContent: "export const App = 1;\n",
          hasUnsavedChanges: false,
        },
      ],
      files: new Map<string, string>([
        ["package.json", installed],
        ["package-lock.json", lockfile],
        ["node_modules/react-router-dom/package.json", "{}\n"],
      ]),
    });

    assert.equal(applied.changed, true);
    const saved = JSON.stringify(applied.tree);
    assert.match(saved, /react-router-dom/);
    assert.match(saved, /lockfileVersion/);
    assert.equal(saved.includes("node_modules"), false);
    const manifest = applied.openFiles.find((file) => file.id === "package.json");
    assert.equal(manifest?.content, installed);
    assert.equal(manifest?.originalContent, installed);
    assert.equal(manifest?.hasUnsavedChanges, false);
    assert.equal(applied.openFiles.find((file) => file.id === "App.tsx")?.content, "export const App = 1;\n");
  });

  it("leaves a dirty package.json tab in place so its edit can be rebased on save", () => {
    const applied = applyExternalFileContents({
      tree: reactTree(),
      openFiles: [
        {
          id: "package.json",
          content: edited,
          originalContent: baseline,
          hasUnsavedChanges: true,
        },
      ],
      files: new Map([["package.json", installed]]),
    });

    assert.equal(applied.openFiles[0]?.content, edited);
    assert.equal(applied.openFiles[0]?.originalContent, baseline);
    assert.match(JSON.stringify(applied.tree), /react-router-dom/);
    assert.equal(JSON.stringify(applied.tree).includes("ctrlaltfixTest"), false);
  });

  it("does nothing when the container manifests already match the project", () => {
    const tree = reactTree(installed);
    const applied = applyExternalFileContents({
      tree,
      openFiles: [],
      files: new Map([["package.json", installed]]),
    });

    assert.equal(applied.changed, false);
    assert.equal(applied.tree, tree);
  });
});

describe("editor writes against a newer container file", () => {
  it("rebases an unrelated editor edit onto the installed manifest", () => {
    const decision = resolveEditorWrite({
      path: "package.json",
      baseline,
      editor: edited,
      disk: installed,
    });

    assert.equal(decision.write, true);
    assert.equal(decision.editorSaved, true);
    assert.match(decision.content, /ctrlaltfixTest/);
    assert.match(decision.content, /"react-router-dom": "\^7\.18\.4"/);
  });

  it("writes the editor text when the container still matches the baseline", () => {
    const decision = resolveEditorWrite({
      path: "App.tsx",
      baseline: "export const App = 1;\n",
      editor: "export const App = 2;\n",
      disk: "export const App = 1;\n",
    });

    assert.deepEqual(decision, {
      content: "export const App = 2;\n",
      write: true,
      editorSaved: true,
    });
  });

  it("keeps a lockfile the package manager rewrote", () => {
    const decision = resolveEditorWrite({
      path: "package-lock.json",
      baseline: "{}\n",
      editor: '{"editor":true}\n',
      disk: '{"packages":{"react-router-dom":{}}}\n',
    });

    assert.equal(decision.write, false);
    assert.equal(decision.editorSaved, false);
    assert.match(decision.content, /react-router-dom/);
  });

  it("still lets the editor save a lockfile the container has not changed", () => {
    const decision = resolveEditorWrite({
      path: "package-lock.json",
      baseline: "{}\n",
      editor: '{"editor":true}\n',
      disk: "{}\n",
    });

    assert.equal(decision.write, true);
    assert.equal(decision.content, '{"editor":true}\n');
  });
});

describe("preview content updates", () => {
  it("writes an editor change and skips a container file that already moved", () => {
    assert.equal(
      shouldWriteContainerFile({
        previous: "export const App = 1;\n",
        next: "export const App = 2;\n",
        disk: "export const App = 1;\n",
      }),
      true,
    );
    assert.equal(
      shouldWriteContainerFile({
        previous: baseline,
        next: baseline,
        disk: installed,
      }),
      false,
    );
    assert.equal(
      shouldWriteContainerFile({
        previous: baseline,
        next: edited,
        disk: installed,
      }),
      false,
    );
    assert.equal(
      shouldWriteContainerFile({
        previous: undefined,
        next: installed,
        disk: null,
      }),
      true,
    );
  });
});

describe("createExclusiveQueue", () => {
  it("runs a later save after the package-manager import finishes", async () => {
    const enqueue = createExclusiveQueue();
    const order: string[] = [];
    let releaseImport: () => void = () => {};
    const imported = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });

    const first = enqueue(async () => {
      order.push("import-start");
      await imported;
      order.push("import-end");
    });
    const second = enqueue(async () => {
      order.push("save");
    });
    await Promise.resolve();
    assert.deepEqual(order, ["import-start"]);
    releaseImport();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["import-start", "import-end", "save"]);
  });
});
