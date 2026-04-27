import { eq, getDb, users } from "@arena/db";
import { getSessionUser } from "./supabase-server.ts";

/**
 * Returns the application user row, creating one on first sign-in.
 */
export async function getCurrentUser() {
  const auth = await getSessionUser();
  if (!auth) return null;
  const db = getDb();
  const found = await db.select().from(users).where(eq(users.authId, auth.id)).limit(1);
  if (found[0]) return found[0];
  const inserted = await db
    .insert(users)
    .values({
      authId: auth.id,
      email: auth.email ?? "",
      name: (auth.user_metadata?.full_name as string | undefined) ?? null,
    })
    .returning();
  return inserted[0]!;
}

export async function requireUser() {
  const u = await getCurrentUser();
  if (!u) throw new Error("UNAUTHORIZED");
  return u;
}

export async function requireAdmin() {
  const u = await requireUser();
  if (u.role !== "admin") throw new Error("FORBIDDEN");
  return u;
}
