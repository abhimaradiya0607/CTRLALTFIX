import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groundingFromRetrieval, parsePlaygroundId } from "./chat-grounding.ts";
import type { RetrieveResult } from "../../rag/lib/retrieve.ts";

function ok(matches: RetrieveResult extends { status: "ok" } ? RetrieveResult["matches"] : never): RetrieveResult {
  return { status: "ok", matches, model: "embed-model", dimensions: 768 };
}

describe("parsePlaygroundId", () => {
  it("accepts a plain id and rejects anything else", () => {
    assert.equal(parsePlaygroundId("  playground-1  "), "playground-1");
    assert.equal(parsePlaygroundId(""), null);
    assert.equal(parsePlaygroundId("   "), null);
    assert.equal(parsePlaygroundId("x".repeat(129)), null);
    assert.equal(parsePlaygroundId(12), null);
    assert.equal(parsePlaygroundId({ id: "playground-1" }), null);
  });
});

describe("groundingFromRetrieval", () => {
  it("does not turn an ownership or auth failure into an answer", () => {
    const signedOut = groundingFromRetrieval({
      status: "error",
      code: "unauthenticated",
      message: "You must be signed in to search a project.",
    });
    const notOwned = groundingFromRetrieval({
      status: "error",
      code: "not-found",
      message: "Project not found.",
    });

    assert.deepEqual(signedOut, { kind: "denied", status: 401, code: "unauthenticated" });
    assert.deepEqual(notOwned, { kind: "denied", status: 404, code: "not_found" });
  });

  it("answers with the retrieved chunks when the index has matches", () => {
    const grounding = groundingFromRetrieval(
      ok([
        { path: "src/App.tsx", content: "export const App = 1;\n", startLine: 1, endLine: 2, score: 0.8 },
      ]),
    );

    assert.equal(grounding.kind, "answer");
    if (grounding.kind !== "answer") return;
    assert.deepEqual(grounding.snippets, [
      { path: "src/App.tsx", content: "export const App = 1;\n", startLine: 1, endLine: 2 },
    ]);
    assert.equal("score" in grounding.snippets[0]!, false);
  });

  it("answers with no snippets when the project has no index or no matches", () => {
    const grounding = groundingFromRetrieval(ok([]));
    assert.deepEqual(grounding, { kind: "answer", snippets: [] });
  });

  it("fails the request when embedding or vector search fails", () => {
    for (const code of ["provider-failed", "invalid-embeddings", "search-failed", "storage-failed", "not-configured", "model-mismatch"] as const) {
      const grounding = groundingFromRetrieval({ status: "error", code, message: "failed" });
      assert.equal(grounding.kind, "failed");
      if (grounding.kind === "failed") assert.equal(grounding.code, "retrieval_failed");
    }
  });
});
