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
  // Show every active bot — sorted: training targets first, then by name.
  const rows = all
    .map((b) => ({
      id: b.id,
      name: b.name,
      ownerId: b.ownerId.slice(0, 8),
      isOfficial: b.isOfficial,
      isTrainingTarget: b.isTrainingTarget,
    }))
    .sort((a, b) => {
      if (a.isTrainingTarget !== b.isTrainingTarget) return a.isTrainingTarget ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return (
    <div>
      <h1>Admin · Training targets</h1>
      <p style={{ color: "var(--fg-dim)" }}>
        Toggle bots into the trainer. The trainer service runs as a separate process
        (<code>bun run trainer</code> locally, or a worker dyno in prod) and evolves the
        weights of every bot flagged here. Opponents are sampled from the rest of the
        active bot pool — their params are read but never written.
      </p>
      <TrainingClient rows={rows} />
    </div>
  );
}
