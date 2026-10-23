import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  codeSuggestionFailure,
  codeSuggestionFailureLog,
} from "./suggestion-request.ts";

const secret = "sk-live-SECRET-do-not-leak const password = 'hunter2'";

describe("code suggestion failures", () => {
  it("returns a generic 500 body without the exception text", () => {
    const failure = codeSuggestionFailure();
    const raw = JSON.stringify(failure.body);

    assert.equal(failure.status, 500);
    assert.equal(raw.includes(secret), false);
    assert.deepEqual(failure.body, {
      error: "Internal server error",
      message: "Failed to generate code suggestion",
    });
  });

  it("logs the error type and not the exception message", () => {
    const log = codeSuggestionFailureLog(new Error(secret));

    assert.equal(log, "Code suggestion failed: Error");
    assert.equal(log.includes(secret), false);
  });

  it("logs an unknown failure without a message", () => {
    assert.equal(codeSuggestionFailureLog("not-an-error"), "Code suggestion failed: UnknownError");
  });
});
