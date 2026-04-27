import type { RatingRepo, RatingRow } from "@arena/application";
import { and, bots, desc, eq, getDb, inArray, ratings, type Db } from "@arena/db";


export class DrizzleRatingRepo implements RatingRepo {
  private _db?: Db;
  constructor(db?: Db) { if (db) this._db = db; }
  private get db(): Db { return this._db ?? getDb(); }

  async findBySeason(seasonId: string, botIds: string[]): Promise<RatingRow[]> {
    if (botIds.length === 0) return [];
    const rows = await this.db.select().from(ratings)
      .where(and(eq(ratings.seasonId, seasonId), inArray(ratings.botId, botIds)));
    return rows.map((r) => ({
      botId: r.botId, seasonId: r.seasonId, rating: r.rating, rd: r.rd, vol: r.vol, games: r.games,
    }));
  }

  async upsert(input: RatingRow): Promise<void> {
    await this.db.insert(ratings).values({
      botId: input.botId,
      seasonId: input.seasonId,
      rating: input.rating,
      rd: input.rd,
      vol: input.vol,
      games: input.games,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [ratings.botId, ratings.seasonId],
      set: { rating: input.rating, rd: input.rd, vol: input.vol, games: input.games, updatedAt: new Date() },
    });
  }

  async leaderboard(seasonId: string, limit: number) {
    const rows = await this.db.select({
      botId: ratings.botId,
      name: bots.name,
      rating: ratings.rating,
      rd: ratings.rd,
      games: ratings.games,
    })
      .from(ratings)
      .innerJoin(bots, eq(bots.id, ratings.botId))
      .where(eq(ratings.seasonId, seasonId))
      .orderBy(desc(ratings.rating))
      .limit(limit);
    return rows;
  }
}
