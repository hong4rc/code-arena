import { headers as nextHeaders } from "next/headers";

import { composition } from "@/composition";

import { auth } from "./auth-server.ts";

/**
 * Returns the application user row for the current request, or null.
 *
 * Pass `req.headers` directly when called from a route handler — that's the
 * canonical Better Auth pattern. In server components / pages, omit it and
 * we'll fall back to `next/headers`.
 */
export async function getCurrentUser(headers?: Headers) {
  const hdrs = headers ?? (await nextHeaders());
  const session = await auth.api.getSession({ headers: hdrs });
  if (!session?.user) return null;
  return composition.repos.users.findById(session.user.id);
}

export async function requireUser(headers?: Headers) {
  const u = await getCurrentUser(headers);
  if (!u) throw new Error("UNAUTHORIZED");
  return u;
}

export async function requireAdmin(headers?: Headers) {
  const u = await requireUser(headers);
  if (u.role !== "admin") throw new Error("FORBIDDEN");
  return u;
}
