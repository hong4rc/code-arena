import { redirect } from "next/navigation";

import { composition } from "@/composition";
import { getCurrentUser } from "@/lib/auth";

import { TrainingClient } from "./client.tsx";

export const dynamic = "force-dynamic";

export default async function AdminTrainingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  const all = await composition.repos.bots.findActive();
  // Pull stats per bot in parallel so the page render time stays flat.
  const rows = await Promise.all(all.map(async (b) => {
    const s = await composition.repos.matches.statsByBot(b.id);
    return {
      id: b.id,
      name: b.name,
      ownerId: b.ownerId.slice(0, 8),
      isOfficial: b.isOfficial,
      isTrainingTarget: b.isTrainingTarget,
      matches: s.matches,
      wins: s.wins,
      winRate: s.matches > 0 ? s.wins / s.matches : 0,
      avgPlacement: s.avgPlacement,
    };
  }));

  rows.sort((a, b) => {
    if (a.isTrainingTarget !== b.isTrainingTarget) return a.isTrainingTarget ? -1 : 1;
    if (a.winRate !== b.winRate) return b.winRate - a.winRate;
    return a.name.localeCompare(b.name);
  });

  return (
    <div>
      <h1>Admin · Training targets</h1>
      <p style={{ color: "var(--fg-dim)" }}>
        Toggle bots into the in-process trainer. Win-rate columns are computed across every
        finished ranked match in the DB — training matches are <em>not</em> counted there
        (they don&apos;t touch the matches table). Opponents are sampled from the rest of the
        active bot pool; their params are read but never written.
      </p>
      <TrainingClient rows={rows} />
    </div>
  );
}
