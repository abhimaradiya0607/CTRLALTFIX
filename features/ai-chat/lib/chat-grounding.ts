import type { RetrievedPromptSnippet } from "./project-context.ts";
import type { RetrieveResult } from "../../rag/lib/retrieve.ts";

export type ChatGrounding =
  | { kind: "answer"; snippets: RetrievedPromptSnippet[] }
  | { kind: "denied"; status: 401 | 404; code: "unauthenticated" | "not_found" }
  | { kind: "failed"; status: 503; code: "retrieval_failed" };

const DENIED_MESSAGES = {
  unauthenticated: "Sign in to ask about this project.",
  not_found: "This project is not available for your account.",
} as const;

export function chatGroundingErrorMessage(
  code: "unauthenticated" | "not_found" | "retrieval_failed" | "invalid_playground",
): string {
  if (code === "unauthenticated" || code === "not_found") return DENIED_MESSAGES[code];
  if (code === "invalid_playground") return "A playground id is required.";
  return "Project search failed, so no answer was generated. Please try again.";
}

/** Accepts only a plain id string. Ownership is checked later by retrieval. */
export function parsePlaygroundId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (id.length === 0 || id.length > 128) return null;
  return id;
}

/**
 * Turns a retrieval result into a chat decision.
 * Auth and ownership failures never become a normal answer.
 * An empty index is an answer with no snippets, not an error.
 */
export function groundingFromRetrieval(result: RetrieveResult): ChatGrounding {
  if (result.status === "error") {
    if (result.code === "unauthenticated") {
      return { kind: "denied", status: 401, code: "unauthenticated" };
    }
    if (result.code === "not-found") {
      return { kind: "denied", status: 404, code: "not_found" };
    }
    return { kind: "failed", status: 503, code: "retrieval_failed" };
  }

  return {
    kind: "answer",
    snippets: result.matches.map((match) => ({
      path: match.path,
      startLine: match.startLine,
      endLine: match.endLine,
      content: match.content,
    })),
  };
}
