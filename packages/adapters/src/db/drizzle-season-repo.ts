import type { Season, SeasonRepo } from "@arena/application";
import { eq, getDb, seasons, type Db } from "@arena/db";


export class DrizzleSeasonRepo implements SeasonRepo {
  private _db?: Db;
  constructor(db?: Db) { if (db) this._db = db; }
  private get db(): Db { return this._db ?? getDb(); }

  async findActive(): Promise<Season | null> {
    const [row] = await this.db.select().from(seasons).where(eq(seasons.isActive, true)).limit(1);
    return row ? {
      id: row.id, name: row.name, isActive: row.isActive,
      startedAt: row.startedAt, endedAt: row.endedAt, configId: row.configId,
    } : null;
  }
}
