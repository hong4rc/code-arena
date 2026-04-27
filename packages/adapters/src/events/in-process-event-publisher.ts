import type { EventPublisher } from "@arena/application";
import type { TickReplay } from "@arena/domain";

type Listener = (tick: TickReplay) => void;

/** Single-process pubsub: runner publishes ticks; WebSocket handlers subscribe. */
export class InProcessEventPublisher implements EventPublisher {
  private channels = new Map<string, Set<Listener>>();

  publishTick(matchId: string, tick: TickReplay): void {
    const listeners = this.channels.get(matchId);
    if (!listeners) return;
    for (const l of listeners) {
      try { l(tick); } catch { /* ignore */ }
    }
  }

  subscribe(matchId: string, listener: Listener): () => void {
    let set = this.channels.get(matchId);
    if (!set) {
      set = new Set();
      this.channels.set(matchId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.channels.delete(matchId);
    };
  }

  endChannel(matchId: string): void {
    this.channels.delete(matchId);
  }
}
