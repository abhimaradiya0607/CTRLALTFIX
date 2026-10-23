import { auth } from "@/auth";
import { db } from "@/lib/db";
import type { Templates } from "@/lib/generated/prisma/enums";
import { decideProjectAccess } from "./project-access-decision";

export type OwnedPlayground = {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  template: Templates;
};

export type OwnedPlaygroundResult =
  | { decision: "allowed"; playground: OwnedPlayground }
  | { decision: "unauthenticated" | "not-found"; playground: null };

export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (typeof userId !== "string" || userId.length === 0) {
    return null;
  }
  return userId;
}

/**
 * Loads a playground only after the session user is known to own it.
 * Callers receive no project fields on failure.
 */
export async function readOwnedPlayground(
  playgroundId: string,
): Promise<OwnedPlaygroundResult> {
  const sessionUserId = await getSessionUserId();
  if (!sessionUserId) {
    return { decision: "unauthenticated", playground: null };
  }

  if (typeof playgroundId !== "string" || playgroundId.length === 0) {
    return { decision: "not-found", playground: null };
  }

  const playground = await db.playground.findUnique({
    where: { id: playgroundId },
    select: {
      id: true,
      userId: true,
      title: true,
      description: true,
      template: true,
    },
  });

  if (decideProjectAccess(sessionUserId, playground) !== "allowed" || !playground) {
    return { decision: "not-found", playground: null };
  }

  return { decision: "allowed", playground };
}
