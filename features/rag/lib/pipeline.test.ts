import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TemplateFolder } from "../../playground/types/index.ts";
import type { EmbeddingProvider } from "./embed-chunks.ts";
import { hashSourceFileContent, type EmbeddingIndexConfig } from "./index-plan.ts";
import { buildIndexUpdate } from "./pipeline.ts";

const embedding: EmbeddingIndexConfig = { model: "test-embed-model", dimensions: 2 };

const tree: TemplateFolder = {
  folderName: "demo",
  items: [
    {
      folderName: "src",
      items: [
        { filename: "App", fileExtension: "tsx", content: "export const App = 1;\n" },
        { filename: "main", fileExtension: "ts", content: "boot();\n" },
      ],
    },
    { filename: ".env", fileExtension: "", content: "SECRET=1\n" },
  ],
};

function recordingEmbedder(seen: string[]): EmbeddingProvider {
  return {
    async embedTexts(texts) {
      seen.push(...texts);
      return texts.map((text) => [text.length, 1]);
    },
  };
}

describe("buildIndexUpdate", () => {
  it("embeds only changed files, keeps unchanged ones, and deletes stale paths", async () => {
    const seen: string[] = [];
    const update = await buildIndexUpdate({
      tree,
      indexedFiles: [
        {
          path: "src/App.tsx",
          contentHash: hashSourceFileContent("export const App = 1;\n"),
          embeddingModel: embedding.model,
          embeddingDimensions: embedding.dimensions,
        },
        {
          path: "src/removed.ts",
          contentHash: "old",
          embeddingModel: embedding.model,
          embeddingDimensions: embedding.dimensions,
        },
      ],
      embedding,
      embedder: recordingEmbedder(seen),
    });

    assert.deepEqual(seen, ["boot();\n"]);
    assert.deepEqual(update.records.map((r) => r.path), ["src/main.ts"]);
    assert.deepEqual(update.embeddedFiles.map((f) => f.path), ["src/main.ts"]);
    assert.equal(update.records[0]?.fileHash, hashSourceFileContent("boot();\n"));
    assert.deepEqual(update.unchanged.map((f) => f.path), ["src/App.tsx"]);
    assert.deepEqual(update.deletedPaths, ["src/removed.ts"]);
  });

  it("never sends excluded files such as .env to the embedder", async () => {
    const seen: string[] = [];
    await buildIndexUpdate({ tree, indexedFiles: [], embedding, embedder: recordingEmbedder(seen) });
    assert.equal(seen.some((text) => text.includes("SECRET")), false);
  });
});
