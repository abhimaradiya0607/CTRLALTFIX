import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHUNK_LIMITS,
  chunkSource,
  joinSourceChunks,
} from "./chunk-source.ts";

describe("chunkSource", () => {
  it("returns no chunks for an empty file", () => {
    assert.deepEqual(chunkSource("src/empty.ts", ""), []);
  });

  it("returns one chunk for a short file", () => {
    const source = "export const value = 1;";
    const chunks = chunkSource("src/short.ts", source);
    assert.equal(chunks.length, 1);
    assert.deepEqual(chunks[0], {
      path: "src/short.ts",
      chunkIndex: 0,
      startLine: 1,
      endLine: 1,
      content: source,
    });
  });

  it("splits when the character limit is reached before the line limit", () => {
    const line = "x".repeat(800);
    const source = `${line}\n${line}`;
    const chunks = chunkSource("src/wide.ts", source);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].chunkIndex, 0);
    assert.equal(chunks[1].chunkIndex, 1);
    assert.equal(chunks[0].startLine, 1);
    assert.equal(chunks[0].endLine, 1);
    assert.equal(chunks[1].startLine, 2);
    assert.equal(chunks[1].endLine, 2);
    assert.equal(joinSourceChunks(chunks), source);
  });

  it("splits when the line limit is reached before the character limit", () => {
    const lines = Array.from({ length: 65 }, (_, index) => `line ${index + 1}`);
    const source = lines.join("\n");
    const chunks = chunkSource("src/lines.ts", source);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].startLine, 1);
    assert.equal(chunks[0].endLine, CHUNK_LIMITS.maxLines);
    assert.equal(chunks[1].startLine, CHUNK_LIMITS.maxLines + 1);
    assert.equal(chunks[1].endLine, 65);
    assert.equal(joinSourceChunks(chunks), source);
  });

  it("keeps a single overlong line intact in its own chunk", () => {
    const longLine = "y".repeat(CHUNK_LIMITS.maxChars + 100);
    const source = `${longLine}\nnext\n`;
    const chunks = chunkSource("src/long-line.ts", source);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].startLine, 1);
    assert.equal(chunks[0].endLine, 1);
    assert.equal(chunks[0].content, `${longLine}\n`);
    assert.equal(chunks[0].content.length, longLine.length + 1);
    assert.equal(chunks[1].content, "next\n");
    assert.equal(joinSourceChunks(chunks), source);
  });

  it("reconstructs the original source from sequential chunks", () => {
    const source = [
      "import React from 'react';",
      "",
      "export function App() {",
      "  return <div>Hello</div>;",
      "}",
      "",
    ].join("\n");
    const chunks = chunkSource("src/App.tsx", source);
    assert.ok(chunks.length >= 1);
    assert.equal(joinSourceChunks(chunks), source);
    assert.equal(chunks[0].chunkIndex, 0);
    for (let index = 1; index < chunks.length; index += 1) {
      assert.equal(chunks[index].chunkIndex, index);
      assert.equal(chunks[index].startLine, chunks[index - 1].endLine + 1);
    }
  });
});
