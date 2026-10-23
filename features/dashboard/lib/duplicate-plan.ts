import type { ProjectAccessDecision } from "@/features/playground/lib/project-access-decision";

export type DuplicatePlan =
  | { outcome: "error"; error: "Unauthorized" | "Failed to duplicate project" }
  | {
      outcome: "metadata-only";
      title: string;
      description: string | null;
      template: string;
      userId: string;
    }
  | {
      outcome: "copy-tree";
      title: string;
      description: string | null;
      template: string;
      userId: string;
      content: unknown;
    };

/**
 * Decides what a duplicate should store.
 * The saved tree is cloned so the new project does not share the original object.
 * A missing tree stays missing, and the playground loader scans the starter.
 */
export function planProjectDuplicate(input: {
  decision: ProjectAccessDecision;
  sessionUserId: string | null;
  title: string;
  description: string | null;
  template: string;
  savedContent: unknown;
}): DuplicatePlan {
  if (input.decision === "unauthenticated") {
    return { outcome: "error", error: "Unauthorized" };
  }
  if (input.decision !== "allowed") {
    return { outcome: "error", error: "Failed to duplicate project" };
  }
  if (typeof input.sessionUserId !== "string" || input.sessionUserId.length === 0) {
    return { outcome: "error", error: "Unauthorized" };
  }

  const metadata = {
    title: `${input.title} - Copy`,
    description: input.description,
    template: input.template,
    userId: input.sessionUserId,
  };

  if (input.savedContent == null) {
    return { outcome: "metadata-only", ...metadata };
  }

  return {
    outcome: "copy-tree",
    ...metadata,
    content: JSON.parse(JSON.stringify(input.savedContent)),
  };
}
