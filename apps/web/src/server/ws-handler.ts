import { composition } from "@/composition";

import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";


/**
 * Handle a WebSocket upgrade for /api/ws/match/:id.
 * Hydrates with any existing replay ticks first, then streams live ticks.
 */
export async function handleMatchWs(ws: WebSocket, _req: IncomingMessage, matchId: string): Promise<void> {
  const match = await composition.repos.matches.findById(matchId);
  if (!match) {
    ws.close(1008, "match not found");
    return;
  }

  const ticks = await composition.repos.matches.loadReplay(matchId);
  if (ticks) {
    for (const t of ticks) {
      try { ws.send(JSON.stringify(t)); } catch { /* ignore */ }
    }
  }

  if (match.status !== "running") {
    ws.close(1000, "not live");
    return;
  }

  const unsubscribe = composition.events.subscribe(matchId, (tick) => {
    try { ws.send(JSON.stringify(tick)); } catch { /* ignore */ }
  });

  ws.on("close", unsubscribe);
  ws.on("error", unsubscribe);
}
