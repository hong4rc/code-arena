import type { ResolvedAction } from "./types.ts";

/**
 * Snapshot of the world at the end of one tick — what we persist for replays.
 *
 * NOTE: per-bot observations are deliberately omitted. They're deterministic
 * from the world state + visionRadius, so the bot-POV viewer recomputes them
 * on demand. Including them was 10× the bytes for no extra information.
 */
export interface TickReplay {
  tick: number;
  actions: ResolvedAction[];
  worldSnapshot: {
    bots: { id: string; x: number; y: number; size: number; hp: number; alive: boolean; inventory: string[] }[];
    items: { id: string; kind: string; x: number; y: number }[];
    bullets: { id: string; x: number; y: number; vx: number; vy: number; ownerId: string }[];
    zone: { xMin: number; yMin: number; xMax: number; yMax: number };
    nextZone?: { xMin: number; yMin: number; xMax: number; yMax: number } | null;
    nextShrinkAtTick?: number | null;
  };
}
