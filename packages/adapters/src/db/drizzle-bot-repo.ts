import type { Bot, BotRepo, BotVersion } from "@arena/application";
import { and, bots, botVersions, desc, eq, getDb, matchParticipants, type Db } from "@arena/db";


export class DrizzleBotRepo implements BotRepo {
  private _db?: Db;
  constructor(db?: Db) { if (db) this._db = db; }
  private get db(): Db { return this._db ?? getDb(); }

  async findById(id: string): Promise<Bot | null> {
    const [row] = await this.db.select().from(bots).where(eq(bots.id, id)).limit(1);
    return row ? this.toBot(row) : null;
  }

  async findByIdAndOwner(id: string, ownerId: string): Promise<Bot | null> {
    const [row] = await this.db.select().from(bots)
      .where(and(eq(bots.id, id), eq(bots.ownerId, ownerId))).limit(1);
    return row ? this.toBot(row) : null;
  }

  async findOfficial(): Promise<Bot[]> {
    const rows = await this.db.select().from(bots).where(eq(bots.isOfficial, true));
    return rows.map((r) => this.toBot(r));
  }

  async findByOwner(ownerId: string): Promise<Bot[]> {
    const rows = await this.db.select().from(bots).where(eq(bots.ownerId, ownerId));
    return rows.map((r) => this.toBot(r));
  }

  async findActive(): Promise<Bot[]> {
    // ANY bot (official or user-owned) with a current runnable version.
    // Including official samples means the system has something to play
    // with from a fresh seed before any users have signed up.
    const rows = await this.db.select().from(bots);
    return rows.filter((r) => r.currentVersionId !== null).map((r) => this.toBot(r));
  }

  async create(input: { ownerId: string; name: string; description?: string | null; isOfficial?: boolean; isPublic?: boolean; clonedFromBotId?: string | null }): Promise<Bot> {
    const [row] = await this.db.insert(bots).values({
      ownerId: input.ownerId,
      name: input.name,
      description: input.description ?? null,
      isOfficial: input.isOfficial ?? false,
      isPublic: input.isPublic ?? false,
      clonedFromBotId: input.clonedFromBotId ?? null,
    }).returning();
    return this.toBot(row!);
  }

  async rename(id: string, name: string): Promise<void> {
    await this.db.update(bots).set({ name }).where(eq(bots.id, id));
  }

  async setCurrentVersion(botId: string, versionId: string): Promise<void> {
    await this.db.update(bots).set({ currentVersionId: versionId }).where(eq(bots.id, botId));
  }

  async saveVersion(input: { botId: string; code: string; language: "js" | "ts"; isRunnable: boolean; validationLog: unknown[]; sha256: string }): Promise<BotVersion> {
    const [row] = await this.db.insert(botVersions).values({
      botId: input.botId,
      code: input.code,
      language: input.language,
      isRunnable: input.isRunnable,
      validationLog: input.validationLog,
      sha256: input.sha256,
    }).returning();
    return this.toVersion(row!);
  }

  async latestVersion(botId: string): Promise<BotVersion | null> {
    const [row] = await this.db.select().from(botVersions)
      .where(eq(botVersions.botId, botId))
      .orderBy(desc(botVersions.uploadedAt))
      .limit(1);
    return row ? this.toVersion(row) : null;
  }

  async latestRunnableVersion(botId: string): Promise<BotVersion | null> {
    const [row] = await this.db.select().from(botVersions)
      .where(and(eq(botVersions.botId, botId), eq(botVersions.isRunnable, true)))
      .orderBy(desc(botVersions.uploadedAt))
      .limit(1);
    return row ? this.toVersion(row) : null;
  }

  async findTrainingTargets(): Promise<Bot[]> {
    const rows = await this.db.select().from(bots).where(eq(bots.isTrainingTarget, true));
    return rows.filter((r) => r.currentVersionId !== null).map((r) => this.toBot(r));
  }

  async setTrainingTarget(id: string, on: boolean): Promise<void> {
    await this.db.update(bots).set({ isTrainingTarget: on }).where(eq(bots.id, id));
  }

  async delete(id: string): Promise<void> {
    // match_participants references bots.id without ON DELETE CASCADE.
    // Clear those rows first, then delete the bot — that cascades to:
    //   bot_versions, ratings, match_queue (all defined with ON DELETE CASCADE).
    await this.db.delete(matchParticipants).where(eq(matchParticipants.botId, id));
    await this.db.delete(bots).where(eq(bots.id, id));
  }

  private toBot(row: typeof bots.$inferSelect): Bot {
    return {
      id: row.id,
      ownerId: row.ownerId,
      name: row.name,
      description: row.description,
      isPublic: row.isPublic,
      isOfficial: row.isOfficial,
      isTrainingTarget: row.isTrainingTarget,
      clonedFromBotId: row.clonedFromBotId,
      currentVersionId: row.currentVersionId,
      createdAt: row.createdAt,
    };
  }

  private toVersion(row: typeof botVersions.$inferSelect): BotVersion {
    return {
      id: row.id,
      botId: row.botId,
      code: row.code,
      language: row.language,
      isRunnable: row.isRunnable,
      validationLog: row.validationLog as unknown[],
      sha256: row.sha256,
      uploadedAt: row.uploadedAt,
    };
  }
}
