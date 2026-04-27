import type { Observation, ResolvedAction } from "./types.ts";

/** Snapshot of the world at the end of one tick — what we persist for replays. */
export interface TickReplay {
  tick: number;
  actions: ResolvedAction[];
  observations: Record<string, Observation>;
  worldSnapshot: {
    bots: { id: string; x: number; y: number; hp: number; alive: boolean; inventory: string[] }[];
    items: { id: string; kind: string; x: number; y: number }[];
  };
}
