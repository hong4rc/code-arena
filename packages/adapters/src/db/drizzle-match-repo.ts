import type {
  Match,
  MatchKind,
  MatchParticipant,
  MatchRepo,
} from "@arena/application";
import {
  and,
  desc,
  eq,
  getDb,
  matchParticipants,
  matchReplays,
  matches,
  type Db,
} from "@arena/db";
import type { TickReplay } from "@arena/domain";

export class DrizzleMatchRepo implements MatchRepo {
  private _db?: Db;
  constructor(db?: Db) { if (db) this._db = db; }
  private get db(): Db { return this._db ?? getDb(); }

  async findById(id: string): Promise<Match | null> {
    const [row] = await this.db.select().from(matches).where(eq(matches.id, id)).limit(1);
    return row ? this.toMatch(row) : null;
  }

  async pickPending(limit: number): Promise<Match[]> {
    const rows = await this.db.select().from(matches).where(eq(matches.status, "pending")).limit(limit);
    return rows.map((r) => this.toMatch(r));
  }

  async recent(limit: number): Promise<Match[]> {
    const rows = await this.db.select().from(matches).orderBy(desc(matches.createdAt)).limit(limit);
    return rows.map((r) => this.toMatch(r));
  }

  async create(input: { seasonId: string; kind: MatchKind; seed: number }): Promise<Match> {
    const [row] = await this.db.insert(matches).values({
      seasonId: input.seasonId,
      kind: input.kind,
      status: "pending",
      seed: input.seed,
    }).returning();
    return this.toMatch(row!);
  }

  async markRunning(id: string, startedAt: Date): Promise<void> {
    await this.db.update(matches).set({ status: "running", startedAt }).where(eq(matches.id, id));
  }

  async markDone(id: string, finishedAt: Date): Promise<void> {
    await this.db.update(matches).set({ status: "done", finishedAt }).where(eq(matches.id, id));
  }

  async markFailed(id: string, finishedAt: Date): Promise<void> {
    await this.db.update(matches).set({ status: "failed", finishedAt }).where(eq(matches.id, id));
  }

  async addParticipant(input: { matchId: string; botId: string; botVersionId: string }): Promise<void> {
    await this.db.insert(matchParticipants).values(input);
  }

  async participants(matchId: string): Promise<MatchParticipant[]> {
    const rows = await this.db.select().from(matchParticipants).where(eq(matchParticipants.matchId, matchId));
    return rows.map((r) => ({
      matchId: r.matchId,
      botVersionId: r.botVersionId,
      botId: r.botId,
      placement: r.placement,
      finalHp: r.finalHp,
      damageDealt: r.damageDealt,
      itemsPicked: r.itemsPicked,
      ratingDelta: r.ratingDelta,
    }));
  }

  async setParticipantOutcome(input: { matchId: string; botId: string; placement: number; finalHp: number; ratingDelta?: number }): Promise<void> {
    await this.db.update(matchParticipants).set({
      placement: input.placement,
      finalHp: input.finalHp,
      ...(input.ratingDelta === undefined ? {} : { ratingDelta: input.ratingDelta }),
    }).where(and(eq(matchParticipants.matchId, input.matchId), eq(matchParticipants.botId, input.botId)));
  }

  async saveReplay(matchId: string, ticks: TickReplay[]): Promise<void> {
    await this.db.insert(matchReplays).values({ matchId, ticks }).onConflictDoNothing();
  }

  async loadReplay(matchId: string): Promise<TickReplay[] | null> {
    const [row] = await this.db.select().from(matchReplays).where(eq(matchReplays.matchId, matchId)).limit(1);
    return row ? (row.ticks as TickReplay[]) : null;
  }

  private toMatch(row: typeof matches.$inferSelect): Match {
    return {
      id: row.id,
      seasonId: row.seasonId,
      kind: row.kind,
      status: row.status,
      configId: row.configId,
      seed: row.seed,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      winnerBotVersionId: row.winnerBotVersionId,
      createdAt: row.createdAt,
    };
  }
}
