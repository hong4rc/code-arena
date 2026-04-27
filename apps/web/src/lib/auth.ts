import { headers } from "next/headers";
import { eq, getDb, users } from "@arena/db";
import { auth } from "./auth-server.ts";

/** Returns the application user row for the current request, or null. */
export async function getCurrentUser() {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });
  if (!session?.user) return null;
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  return row ?? null;
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
