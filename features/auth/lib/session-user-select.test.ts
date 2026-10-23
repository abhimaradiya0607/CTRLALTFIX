import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accountCredentialFields,
  sessionUserSelect,
} from "./session-user-select.ts";

describe("sessionUserSelect", () => {
  it("returns only the fields the JWT callback copies onto the session", () => {
    assert.deepEqual(
      Object.keys(sessionUserSelect).sort(),
      ["email", "id", "name", "role"],
    );
  });

  it("does not select account credentials or the accounts relation", () => {
    const selected = Object.keys(sessionUserSelect);
    for (const field of accountCredentialFields) {
      assert.equal(selected.includes(field), false);
    }
    assert.equal("accounts" in sessionUserSelect, false);
  });
});
