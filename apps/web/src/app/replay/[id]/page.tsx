import { notFound } from "next/navigation";

import { ReplayViewer } from "@/components/ReplayViewer";
import { composition } from "@/composition";

export const dynamic = "force-dynamic";

export default async function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = await composition.repos.matches.findById(id);
  if (!match) notFound();
  const [ticks, participants] = await Promise.all([
    composition.repos.matches.loadReplay(id),
    composition.repos.matches.participants(id),
  ]);
  const bots = await Promise.all(participants.map((p) => composition.repos.bots.findById(p.botId)));
  const botNames: Record<string, string> = {};
  for (const b of bots) if (b) botNames[b.id] = b.name;

  return (
    <div>
      <h1>Match {id.slice(0, 8)}</h1>
      <p>Status: {match.status} · Kind: {match.kind}</p>
      <ReplayViewer
        matchId={id}
        initialTicks={(ticks as unknown as never[]) ?? null}
        live={match.status === "running"}
        botNames={botNames}
      />
    </div>
  );
}
