import { db } from "@/lib/db";
import type { UserRole } from "@prisma/client";
import { sessionUserSelect } from "./session-user-select";

export type SessionUserRecord = {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
};

/**
 * Loads the signed-in user for the JWT callback.
 * This is not a server action, so a client cannot pass an arbitrary id to it.
 */
export async function readSessionUserRecord(
  id: string,
): Promise<SessionUserRecord | null> {
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }

  return db.user.findUnique({
    where: { id },
    select: sessionUserSelect,
  });
}
