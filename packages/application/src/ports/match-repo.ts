import type { TickReplay } from "@arena/domain";

export type MatchKind = "auto" | "custom" | "sim" | "test";
export type MatchStatus = "pending" | "running" | "done" | "failed";

export interface Match {
  id: string;
  seasonId: string | null;
  kind: MatchKind;
  status: MatchStatus;
  configId: string | null;
  seed: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  winnerBotVersionId: string | null;
  createdAt: Date;
}

export interface MatchParticipant {
  matchId: string;
  botVersionId: string;
  botId: string;
  placement: number | null;
  finalHp: number | null;
  damageDealt: number;
  itemsPicked: number;
  ratingDelta: number | null;
}

export interface MatchRepo {
  findById(id: string): Promise<Match | null>;
  pickPending(limit: number): Promise<Match[]>;
  recent(limit: number): Promise<Match[]>;
  /** Most recent matches a given bot participated in (any version). */
  recentByBot(botId: string, limit: number): Promise<Array<Match & { placement: number | null; ratingDelta: number | null }>>;
  create(input: { seasonId: string | null; kind: MatchKind; seed: number }): Promise<Match>;
  markRunning(id: string, startedAt: Date): Promise<void>;
  markDone(id: string, finishedAt: Date): Promise<void>;
  markFailed(id: string, finishedAt: Date): Promise<void>;

  addParticipant(input: { matchId: string; botId: string; botVersionId: string }): Promise<void>;
  participants(matchId: string): Promise<MatchParticipant[]>;
  setParticipantOutcome(input: { matchId: string; botId: string; placement: number; finalHp: number; damageDealt?: number; itemsPicked?: number; ratingDelta?: number }): Promise<void>;

  saveReplay(matchId: string, ticks: TickReplay[]): Promise<void>;
  loadReplay(matchId: string): Promise<TickReplay[] | null>;

  /** Hard-delete a single match and its replay/participants. */
  deleteById(id: string): Promise<void>;
  /** Hard-delete all matches (and their replays/participants). Returns count removed. */
  deleteAll(): Promise<number>;
}
