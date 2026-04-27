export interface Bot {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  isOfficial: boolean;
  isTrainingTarget: boolean;
  clonedFromBotId: string | null;
  currentVersionId: string | null;
  createdAt: Date;
}

export interface BotVersion {
  id: string;
  botId: string;
  code: string;
  language: "js" | "ts";
  isRunnable: boolean;
  validationLog: unknown[];
  sha256: string;
  uploadedAt: Date;
}

export interface BotRepo {
  findById(id: string): Promise<Bot | null>;
  findByIdAndOwner(id: string, ownerId: string): Promise<Bot | null>;
  findOfficial(): Promise<Bot[]>;
  findByOwner(ownerId: string): Promise<Bot[]>;
  /** Bots eligible for the matchmaker (not official, has a runnable version). */
  findActive(): Promise<Bot[]>;
  create(input: { ownerId: string; name: string; description?: string | null; isOfficial?: boolean; isPublic?: boolean; clonedFromBotId?: string | null }): Promise<Bot>;
  rename(id: string, name: string): Promise<void>;
  setCurrentVersion(botId: string, versionId: string): Promise<void>;

  saveVersion(input: { botId: string; code: string; language: "js" | "ts"; isRunnable: boolean; validationLog: unknown[]; sha256: string }): Promise<BotVersion>;
  /** Most recent version regardless of runnable. */
  latestVersion(botId: string): Promise<BotVersion | null>;
  /** Most recent runnable version. */
  latestRunnableVersion(botId: string): Promise<BotVersion | null>;

  /** Hard-delete the bot and everything that references it. */
  delete(id: string): Promise<void>;

  /** Bots flagged as training targets (admin toggle). */
  findTrainingTargets(): Promise<Bot[]>;
  /** Toggle whether the trainer service should evolve this bot. */
  setTrainingTarget(id: string, on: boolean): Promise<void>;
}
