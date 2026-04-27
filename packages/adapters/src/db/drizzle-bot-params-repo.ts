import type { BotParamsRepo, BotParamsRow } from "@arena/application";
import { botParams, desc, eq, getDb, sql, type Db } from "@arena/db";

export class DrizzleBotParamsRepo implements BotParamsRepo {
  private _db?: Db;
  constructor(db?: Db) { if (db) this._db = db; }
  private get db(): Db { return this._db ?? getDb(); }

  async latest(botId: string): Promise<BotParamsRow | null> {
    const [row] = await this.db
      .select({ version: botParams.version, params: botParams.params, createdAt: botParams.createdAt })
      .from(botParams)
      .where(eq(botParams.botId, botId))
      .orderBy(desc(botParams.version))
      .limit(1);
    if (!row) return null;
    return { version: row.version, params: row.params, createdAt: row.createdAt };
  }

  async saveNewVersion(botId: string, params: unknown): Promise<{ version: number }> {
    // Atomic next-version: SELECT max(version)+1 + INSERT in one statement using
    // a subquery. The unique (bot_id, version) index protects against races.
    const [row] = await this.db
      .insert(botParams)
      .values({
        botId,
        version: sql<number>`coalesce((select max(version) from ${botParams} where bot_id = ${botId}), 0) + 1`,
        params,
      })
      .returning({ version: botParams.version });
    return { version: row!.version };
  }

  async history(botId: string, limit: number): Promise<BotParamsRow[]> {
    const rows = await this.db
      .select({ version: botParams.version, params: botParams.params, createdAt: botParams.createdAt })
      .from(botParams)
      .where(eq(botParams.botId, botId))
      .orderBy(desc(botParams.version))
      .limit(limit);
    return rows.map((r) => ({ version: r.version, params: r.params, createdAt: r.createdAt }));
  }
}
