import type { TickReplay } from "@arena/runner";

/**
 * Per-process pubsub for live match ticks. The match runner publishes here;
 * WebSocket handlers subscribe.
 */
type Listener = (tick: TickReplay) => void;

const channels = new Map<string, Set<Listener>>();

export function publishTick(matchId: string, tick: TickReplay): void {
  const listeners = channels.get(matchId);
  if (!listeners) return;
  for (const l of listeners) {
    try { l(tick); } catch { /* ignore */ }
  }
}

export function subscribe(matchId: string, listener: Listener): () => void {
  let set = channels.get(matchId);
  if (!set) {
    set = new Set();
    channels.set(matchId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) channels.delete(matchId);
  };
}

export function endChannel(matchId: string): void {
  channels.delete(matchId);
}
