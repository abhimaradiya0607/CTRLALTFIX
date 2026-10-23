import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createdPlaygroundId, readActionError } from "./action-result.ts";

describe("readActionError", () => {
  it("treats a successful delete as no error", () => {
    assert.equal(readActionError(undefined), null);
  });

  it("treats a successful edit payload as no error", () => {
    assert.equal(readActionError({ success: "Project edited successfully" }), null);
  });

  it("treats a created playground as no error", () => {
    assert.equal(
      readActionError({ id: "playground-1", title: "Demo - Copy" }),
      null,
    );
  });

  it("returns the server error string for a refused or failed mutation", () => {
    assert.equal(readActionError({ error: "Unauthorized" }), "Unauthorized");
    assert.equal(
      readActionError({ error: "Failed to delete project" }),
      "Failed to delete project",
    );
    assert.equal(
      readActionError({ error: "Failed to edit project" }),
      "Failed to edit project",
    );
    assert.equal(
      readActionError({ error: "Failed to duplicate project" }),
      "Failed to duplicate project",
    );
  });

  it("uses a fallback when the error field is empty", () => {
    assert.equal(readActionError({ error: "  " }), "Request failed");
  });
});

describe("createdPlaygroundId", () => {
  it("returns the id from a created playground row", () => {
    assert.equal(
      createdPlaygroundId({ id: "playground-1", title: "Demo" }),
      "playground-1",
    );
  });

  it("returns null for createPlayground error results", () => {
    assert.equal(createdPlaygroundId({ error: "Unauthorized" }), null);
    assert.equal(createdPlaygroundId({ error: "User not found" }), null);
    assert.equal(
      createdPlaygroundId({ error: "Failed to create playground" }),
      null,
    );
  });

  it("returns null when an error is present alongside an id", () => {
    assert.equal(
      createdPlaygroundId({ error: "Failed to create playground", id: "playground-1" }),
      null,
    );
  });

  it("returns null when the result has no usable id", () => {
    assert.equal(createdPlaygroundId(undefined), null);
    assert.equal(createdPlaygroundId({ id: "" }), null);
    assert.equal(createdPlaygroundId({ id: 1 }), null);
  });
});
