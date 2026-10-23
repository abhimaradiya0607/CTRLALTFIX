import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TemplateFolder } from "../../playground/lib/path-to-json.ts";
import { transformToWebContainerFormat } from "./transformer.ts";

describe("transformToWebContainerFormat", () => {
  it("maps a playground folder union into WebContainer files and directories", () => {
    const template: TemplateFolder = {
      folderName: "root",
      items: [
        {
          filename: "index",
          fileExtension: "ts",
          content: "export const value = 1;\n",
        },
        {
          folderName: "src",
          items: [
            {
              filename: "app",
              fileExtension: "tsx",
              content: "export function App() { return null; }\n",
            },
          ],
        },
      ],
    };

    assert.deepEqual(transformToWebContainerFormat(template), {
      "index.ts": {
        file: { contents: "export const value = 1;\n" },
      },
      src: {
        directory: {
          "app.tsx": {
            file: { contents: "export function App() { return null; }\n" },
          },
        },
      },
    });
  });
});