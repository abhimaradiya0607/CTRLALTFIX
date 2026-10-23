export type ProjectAccessDecision = "allowed" | "unauthenticated" | "not-found";

/**
 * Decides whether the signed-in user may use a playground.
 * A missing project and a project owned by someone else both return "not-found"
 * so callers do not reveal that the id exists.
 * The user id argument must come from the server session, never from the client.
 */
export function decideProjectAccess(
  sessionUserId: string | null | undefined,
  playground: { userId: string } | null,
): ProjectAccessDecision {
  if (typeof sessionUserId !== "string" || sessionUserId.length === 0) {
    return "unauthenticated";
  }

  if (!playground || playground.userId !== sessionUserId) {
    return "not-found";
  }

  return "allowed";
}
