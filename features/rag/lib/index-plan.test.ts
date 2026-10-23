import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIndexPlan,
  hashSourceFileContent,
  type EmbeddingIndexConfig,
  type IndexedFileRecord,
} from "./index-plan.ts";

const embedding: EmbeddingIndexConfig = {
  model: "qwen3-embedding:0.6b",
  dimensions: 1024,
};

function record(path: string, content: string, config: EmbeddingIndexConfig = embedding): IndexedFileRecord {
  return {
    path,
    contentHash: hashSourceFileContent(content),
    embeddingModel: config.model,
    embeddingDimensions: config.dimensions,
  };
}

describe("hashSourceFileContent", () => {
  it("is stable for identical content and changes when content changes", () => {
    const first = hashSourceFileContent("export const a = 1;");
    const same = hashSourceFileContent("export const a = 1;");
    const different = hashSourceFileContent("export const a = 2;");
    assert.equal(first, same);
    assert.notEqual(first, different);
  });
});

describe("buildIndexPlan", () => {
  it("embeds a new file and skips an unchanged file with compatible metadata", () => {
    const appContent = "export const App = 1;";
    const plan = buildIndexPlan({
      currentFiles: [
        { path: "src/App.tsx", content: appContent },
        { path: "src/main.ts", content: "boot();\n" },
      ],
      indexedFiles: [record("src/App.tsx", appContent)],
      embedding,
    });

    assert.deepEqual(plan.toSkip, [{ path: "src/App.tsx", contentHash: record("src/App.tsx", appContent).contentHash }]);
    assert.equal(plan.toEmbed.length, 1);
    assert.equal(plan.toEmbed[0]?.path, "src/main.ts");
    assert.deepEqual(plan.toDelete, []);
  });

  it("embeds when file content changed", () => {
    const plan = buildIndexPlan({
      currentFiles: [{ path: "src/App.tsx", content: "export const App = 2;" }],
      indexedFiles: [record("src/App.tsx", "export const App = 1;")],
      embedding,
    });
    assert.equal(plan.toSkip.length, 0);
    assert.equal(plan.toEmbed.length, 1);
    assert.equal(plan.toEmbed[0]?.path, "src/App.tsx");
  });

  it("deletes previously indexed paths that are no longer eligible", () => {
    const plan = buildIndexPlan({
      currentFiles: [{ path: "src/App.tsx", content: "ok" }],
      indexedFiles: [record("src/App.tsx", "ok"), record(".env", "SECRET=1"), record("dist/bundle.js", "x")],
      embedding,
    });
    assert.deepEqual(plan.toDelete, [".env", "dist/bundle.js"]);
    assert.equal(plan.toSkip.length, 1);
  });

  it("keeps nested paths and duplicate filenames separate", () => {
    const libButton = "export const helper = 1;";
    const srcButton = "export const Button = 1;";
    const plan = buildIndexPlan({
      currentFiles: [
        { path: "lib/Button.ts", content: libButton },
        { path: "src/Button.tsx", content: srcButton },
      ],
      indexedFiles: [record("lib/Button.ts", libButton)],
      embedding,
    });
    assert.deepEqual(plan.toSkip.map((entry) => entry.path), ["lib/Button.ts"]);
    assert.deepEqual(plan.toEmbed.map((entry) => entry.path), ["src/Button.tsx"]);
  });

  it("returns sorted outputs", () => {
    const plan = buildIndexPlan({
      currentFiles: [
        { path: "z.ts", content: "z" },
        { path: "a.ts", content: "a" },
        { path: "m.ts", content: "m" },
      ],
      indexedFiles: [],
      embedding,
    });
    assert.deepEqual(plan.toEmbed.map((entry) => entry.path), ["a.ts", "m.ts", "z.ts"]);
  });

  it("handles empty current and previous indexes", () => {
    const empty = buildIndexPlan({ currentFiles: [], indexedFiles: [], embedding });
    assert.deepEqual(empty, { toEmbed: [], toSkip: [], toDelete: [] });

    const allNew = buildIndexPlan({
      currentFiles: [{ path: "index.js", content: "start();" }],
      indexedFiles: [],
      embedding,
    });
    assert.equal(allNew.toEmbed.length, 1);
    assert.equal(allNew.toSkip.length, 0);
    assert.deepEqual(allNew.toDelete, []);
  });

  it("requires a full re-index when the embedding model changes", () => {
    const content = "unchanged";
    const plan = buildIndexPlan({
      currentFiles: [{ path: "src/App.tsx", content }],
      indexedFiles: [record("src/App.tsx", content)],
      embedding: { model: "qwen3-embedding:4b", dimensions: 1024 },
    });
    assert.equal(plan.toSkip.length, 0);
    assert.equal(plan.toEmbed.length, 1);
    assert.equal(plan.toEmbed[0]?.path, "src/App.tsx");
  });

  it("requires a full re-index when vector dimensions change", () => {
    const content = "unchanged";
    const plan = buildIndexPlan({
      currentFiles: [{ path: "src/App.tsx", content }],
      indexedFiles: [record("src/App.tsx", content)],
      embedding: { model: embedding.model, dimensions: 512 },
    });
    assert.equal(plan.toSkip.length, 0);
    assert.equal(plan.toEmbed.length, 1);
  });

  it("does not mutate input arrays or records", () => {
    const currentFiles = [{ path: "a.ts", content: "a" }];
    const indexedFiles = [record("a.ts", "a")];
    const beforeCurrent = structuredClone(currentFiles);
    const beforeIndexed = structuredClone(indexedFiles);
    buildIndexPlan({ currentFiles, indexedFiles, embedding });
    assert.deepEqual(currentFiles, beforeCurrent);
    assert.deepEqual(indexedFiles, beforeIndexed);
  });
});
