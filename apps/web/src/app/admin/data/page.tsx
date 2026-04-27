import { redirect } from "next/navigation";

import { composition } from "@/composition";
import { getCurrentUser } from "@/lib/auth";

import { AdminDataClient } from "./client.tsx";

export const dynamic = "force-dynamic";

export default async function AdminDataPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  const [bots, matches] = await Promise.all([
    // Show all bots — official + user-owned. We don't have a "find all" so
    // union: official + active. Admin cleanup mostly targets stale user bots,
    // and `findActive()` covers everything matchmaker sees.
    Promise.all([
      composition.repos.bots.findOfficial(),
      composition.repos.bots.findActive(),
    ]).then(([off, act]) => {
      const seen = new Set<string>();
      return [...off, ...act].filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
    }),
    composition.repos.matches.recent(100),
  ]);

  return (
    <AdminDataClient
      bots={bots.map((b) => ({ id: b.id, name: b.name, isOfficial: b.isOfficial, ownerId: b.ownerId }))}
      matches={matches.map((m) => ({ id: m.id, kind: m.kind, status: m.status, createdAt: m.createdAt.toISOString() }))}
    />
  );
}
