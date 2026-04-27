import type { QueueRepo } from "@arena/application";
import { getDb, inArray, matchQueue, type Db } from "@arena/db";


export class DrizzleQueueRepo implements QueueRepo {
  private _db?: Db;
  constructor(db?: Db) { if (db) this._db = db; }
  private get db(): Db { return this._db ?? getDb(); }

  async enqueued(): Promise<string[]> {
    const rows = await this.db.select({ botId: matchQueue.botId }).from(matchQueue);
    return rows.map((r) => r.botId);
  }

  async drain(botIds: string[]): Promise<void> {
    if (botIds.length === 0) return;
    await this.db.delete(matchQueue).where(inArray(matchQueue.botId, botIds));
  }
}
