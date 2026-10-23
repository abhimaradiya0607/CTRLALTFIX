import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSuggestionRequest,
  editorFileName,
} from "./suggestion-request.ts";

describe("editorFileName", () => {
  it("uses the open tab filename and extension", () => {
    assert.equal(editorFileName("App", "tsx"), "App.tsx");
    assert.equal(editorFileName("main", "py"), "main.py");
  });

  it("keeps a name that has no extension", () => {
    assert.equal(editorFileName("Dockerfile", ""), "Dockerfile");
  });

  it("does not invent a name", () => {
    assert.equal(editorFileName(null, "ts"), null);
    assert.equal(editorFileName("", "ts"), null);
    assert.equal(editorFileName(undefined, undefined), null);
  });
});

describe("buildSuggestionRequest", () => {
  it("includes the active filename in the existing request body", () => {
    assert.deepEqual(
      buildSuggestionRequest({
        fileContent: "import ",
        cursorLine: 0,
        cursorColumn: 7,
        suggestionType: "completion",
        fileName: "App.tsx",
      }),
      {
        fileContent: "import ",
        cursorLine: 0,
        cursorColumn: 7,
        suggestionType: "completion",
        fileName: "App.tsx",
      },
    );
  });

  it("omits fileName when the editor has no active file name", () => {
    const body = buildSuggestionRequest({
      fileContent: "import ",
      cursorLine: 1,
      cursorColumn: 0,
      suggestionType: "completion",
      fileName: null,
    });

    assert.equal("fileName" in body, false);
    assert.equal(body.suggestionType, "completion");
  });
});
