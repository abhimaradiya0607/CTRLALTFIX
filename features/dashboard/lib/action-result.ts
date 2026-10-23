/**
 * Delete resolves with `undefined` on success.
 * Edit resolves with `{ success }`.
 * Create and duplicate resolve with the created playground.
 * These actions resolve with `{ error }` instead of throwing.
 */
export function readActionError(result: unknown): string | null {
  if (result == null || typeof result !== "object") {
    return null;
  }
  if (!("error" in result)) {
    return null;
  }

  const error = (result as { error: unknown }).error;
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "Request failed";
}

/** `createPlayground` returns the new row on success, or `{ error }` when it does not. */
export function createdPlaygroundId(result: unknown): string | null {
  if (readActionError(result) || result == null || typeof result !== "object") {
    return null;
  }
  if (!("id" in result)) {
    return null;
  }

  const id = (result as { id: unknown }).id;
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }
  return id;
}
