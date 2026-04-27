import { notFound } from "next/navigation";

import { ReplayViewer } from "@/components/ReplayViewer";
import { composition } from "@/composition";

export const dynamic = "force-dynamic";

export default async function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = await composition.repos.matches.findById(id);
  if (!match) notFound();
  const ticks = await composition.repos.matches.loadReplay(id);

  return (
    <div>
      <h1>Match {id.slice(0, 8)}</h1>
      <p>Status: {match.status} · Kind: {match.kind}</p>
      <ReplayViewer matchId={id} initialTicks={(ticks as unknown as never[]) ?? null} live={match.status === "running"} />
    </div>
  );
}
