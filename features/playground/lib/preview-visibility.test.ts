import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextPreviewVisible, previewMenuLabel } from "./preview-visibility.ts";

describe("preview visibility", () => {
  it("hides a visible preview and offers to show it again", () => {
    const hidden = nextPreviewVisible(true);
    assert.equal(hidden, false);
    assert.equal(previewMenuLabel(hidden), "Show Preview");
  });

  it("shows a hidden preview and offers to hide it again", () => {
    const visible = nextPreviewVisible(false);
    assert.equal(visible, true);
    assert.equal(previewMenuLabel(visible), "Hide Preview");
  });
});
