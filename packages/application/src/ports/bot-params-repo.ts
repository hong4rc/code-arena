/**
 * Per-bot key-value blob persisted between matches. Versioned (append-only):
 * each save inserts a new row, "latest" reads the highest version. Old
 * versions are kept for rollback and tuning history.
 */
export interface BotParamsRow {
  version: number;
  params: unknown;
  createdAt: Date;
}

export interface BotParamsRepo {
  /** Latest params blob, or null if the bot has never saved any. */
  latest(botId: string): Promise<BotParamsRow | null>;
  /** Insert a new version (auto-incremented). Returns the assigned version. */
  saveNewVersion(botId: string, params: unknown): Promise<{ version: number }>;
  /** Most recent N versions, newest first. Useful for the history UI. */
  history(botId: string, limit: number): Promise<BotParamsRow[]>;
}
