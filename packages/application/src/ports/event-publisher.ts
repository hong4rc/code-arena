import type { TickReplay } from "@arena/domain";

/** Per-process pubsub for live tick streaming to spectators. */
export interface EventPublisher {
  publishTick(matchId: string, tick: TickReplay): void;
  subscribe(matchId: string, listener: (tick: TickReplay) => void): () => void;
  endChannel(matchId: string): void;
}
