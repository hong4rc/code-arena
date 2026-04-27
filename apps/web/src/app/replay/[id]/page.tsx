import { notFound } from "next/navigation";

import { eq, getDb, matchReplays, matches } from "@arena/db";

import { ReplayViewer } from "@/components/ReplayViewer";

export const dynamic = "force-dynamic";

export default async function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, id)).limit(1);
  if (!match) notFound();
  const [replay] = await db.select().from(matchReplays).where(eq(matchReplays.matchId, id)).limit(1);

  return (
    <div>
      <h1>Match {id.slice(0, 8)}</h1>
      <p>Status: {match.status} · Kind: {match.kind}</p>
      <ReplayViewer matchId={id} initialTicks={(replay?.ticks as unknown as never[]) ?? null} live={match.status === "running"} />
    </div>
  );
}