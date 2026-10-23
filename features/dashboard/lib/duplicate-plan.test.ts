import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readActionError } from "./action-result.ts";
import { planProjectDuplicate } from "./duplicate-plan.ts";

function savedTree() {
  return {
    folderName: "react",
    items: [
      {
        filename: "App",
        fileExtension: "tsx",
        content: "export const App = 1;\n",
      },
    ],
  };
}

describe("planProjectDuplicate", () => {
  it("copies saved tree content onto the new project without sharing the object", () => {
    const original = savedTree();
    const plan = planProjectDuplicate({
      decision: "allowed",
      sessionUserId: "user-owner",
      title: "Demo",
      description: "A project",
      template: "REACT",
      savedContent: original,
    });

    assert.equal(plan.outcome, "copy-tree");
    if (plan.outcome !== "copy-tree") return;

    assert.equal(plan.userId, "user-owner");
    assert.equal(plan.title, "Demo - Copy");
    assert.equal(plan.template, "REACT");
    assert.deepEqual(plan.content, original);
    assert.notEqual(plan.content, original);

    original.items[0].content = "mutated original\n";
    assert.equal(
      (plan.content as ReturnType<typeof savedTree>).items[0].content,
      "export const App = 1;\n",
    );

    (plan.content as ReturnType<typeof savedTree>).items[0].content = "mutated copy\n";
    assert.equal(original.items[0].content, "mutated original\n");
  });

  it("leaves a project with no saved tree on the starter-loading path", () => {
    const plan = planProjectDuplicate({
      decision: "allowed",
      sessionUserId: "user-owner",
      title: "Demo",
      description: null,
      template: "REACT",
      savedContent: null,
    });

    assert.deepEqual(plan, {
      outcome: "metadata-only",
      title: "Demo - Copy",
      description: null,
      template: "REACT",
      userId: "user-owner",
    });
  });

  it("refuses another user's project and an unauthenticated caller", () => {
    const hidden = planProjectDuplicate({
      decision: "not-found",
      sessionUserId: "user-other",
      title: "Secret",
      description: "private",
      template: "NEXTJS",
      savedContent: savedTree(),
    });
    const signedOut = planProjectDuplicate({
      decision: "unauthenticated",
      sessionUserId: null,
      title: "Secret",
      description: null,
      template: "REACT",
      savedContent: savedTree(),
    });
    const missingSession = planProjectDuplicate({
      decision: "allowed",
      sessionUserId: "",
      title: "Demo",
      description: null,
      template: "REACT",
      savedContent: savedTree(),
    });

    assert.deepEqual(hidden, {
      outcome: "error",
      error: "Failed to duplicate project",
    });
    assert.equal("content" in hidden, false);
    assert.deepEqual(signedOut, { outcome: "error", error: "Unauthorized" });
    assert.deepEqual(missingSession, { outcome: "error", error: "Unauthorized" });
    assert.equal(readActionError({ error: "Failed to duplicate project" }), "Failed to duplicate project");
    assert.equal(readActionError({ error: "Unauthorized" }), "Unauthorized");
  });
});
