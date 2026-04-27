import { headers } from "next/headers";

import { composition } from "@/composition";

import { auth } from "./auth-server.ts";

/** Returns the application user row for the current request, or null. */
export async function getCurrentUser() {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });
  if (!session?.user) return null;
  return composition.repos.users.findById(session.user.id);
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
