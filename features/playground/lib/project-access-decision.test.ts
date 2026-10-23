import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideProjectAccess } from "./project-access-decision.ts";

describe("decideProjectAccess", () => {
  const ownerId = "user-owner";

  it("allows the session user who owns the project", () => {
    assert.equal(
      decideProjectAccess(ownerId, { userId: ownerId }),
      "allowed",
    );
  });

  it("hides another user's project as not-found", () => {
    assert.equal(
      decideProjectAccess("user-other", { userId: ownerId }),
      "not-found",
    );
  });

  it("treats a missing project as not-found", () => {
    assert.equal(decideProjectAccess(ownerId, null), "not-found");
  });

  it("rejects a missing session before ownership can match", () => {
    assert.equal(decideProjectAccess(null, { userId: ownerId }), "unauthenticated");
    assert.equal(decideProjectAccess(undefined, { userId: ownerId }), "unauthenticated");
    assert.equal(decideProjectAccess("", { userId: ownerId }), "unauthenticated");
  });

  it("does not treat an empty owner id as a match for an empty session", () => {
    assert.equal(decideProjectAccess("", { userId: "" }), "unauthenticated");
    assert.equal(decideProjectAccess(null, null), "unauthenticated");
  });
});
