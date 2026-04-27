import type { Glicko } from "@arena/domain";

export interface RatingRow extends Glicko {
  botId: string;
  seasonId: string;
  games: number;
}

export interface RatingRepo {
  findBySeason(seasonId: string, botIds: string[]): Promise<RatingRow[]>;
  upsert(input: RatingRow): Promise<void>;
  /** Leaderboard: bots sorted by rating desc within a season. */
  leaderboard(seasonId: string, limit: number): Promise<{ botId: string; name: string; rating: number; rd: number; games: number }[]>;
}
