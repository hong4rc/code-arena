import { eq, getDb, matchReplays, matches } from "@arena/db";

import { subscribe } from "./broadcaster.ts";

import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";


/**
 * Handle a WebSocket upgrade for /api/ws/match/:id.
 * Sends every existing tick from the replay (if any), then streams live ticks.
 */
export async function handleMatchWs(ws: WebSocket, _req: IncomingMessage, matchId: string): Promise<void> {
  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) {
    ws.close(1008, "match not found");
    return;
  }

  // Hydrate existing ticks if the match is already running or done.
  const [replay] = await db.select().from(matchReplays).where(eq(matchReplays.matchId, matchId)).limit(1);
  if (replay) {
    const ticks = replay.ticks as unknown as object[];
    for (const t of ticks) {
      try { ws.send(JSON.stringify(t)); } catch { /* ignore */ }
    }
  }

  if (match.status !== "running") {
    ws.close(1000, "not live");
    return;
  }

  const unsub = subscribe(matchId, (tick) => {
    try { ws.send(JSON.stringify(tick)); } catch { /* ignore */ }
  });

  ws.on("close", unsub);
  ws.on("error", unsub);
}
