import { updateGlicko, type Glicko, type MatchResult } from "./glicko2.ts";

export * from "./glicko2.ts";

export interface Participant {
  botId: string;
  rating: Glicko;
  placement: number;
}

/**
 * Convert ordinal placements (1=best) into pairwise scores: each bot gets a
 * Glicko update from its results vs every other bot in the same match.
 *  - placement < other → score = 1 (won)
 *  - placement > other → score = 0 (lost)
 *  - tied placement   → score = 0.5
 */
export function updateMatchRatings(participants: Participant[]): Map<string, Glicko> {
  const next = new Map<string, Glicko>();
  for (const me of participants) {
    const results: MatchResult[] = participants
      .filter((p) => p.botId !== me.botId)
      .map((p) => ({
        opponent: p.rating,
        score: me.placement < p.placement ? 1 : (me.placement > p.placement ? 0 : 0.5),
      }));
    next.set(me.botId, updateGlicko(me.rating, results));
  }
  return next;
}

export const INITIAL_RATING: Glicko = { rating: 1500, rd: 350, vol: 0.06 };
