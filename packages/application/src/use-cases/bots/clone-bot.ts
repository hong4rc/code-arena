import { createHash } from "node:crypto";

import type { BotRepo } from "../../ports/index.ts";

export interface CloneBotInput {
  /** The user requesting the clone. */
  ownerId: string;
  /** The source bot to clone (must be public). */
  sourceBotId: string;
}

export interface CloneBotResult {
  botId: string;
}

export interface CloneBotDeps {
  bots: BotRepo;
}

export class CloneBotUseCase {
  constructor(private deps: CloneBotDeps) {}

  async execute(input: CloneBotInput): Promise<CloneBotResult> {
    const src = await this.deps.bots.findById(input.sourceBotId);
    if (!src || !src.isPublic) throw new Error("source bot not found or not public");
    const srcVersion = await this.deps.bots.latestVersion(src.id);
    if (!srcVersion) throw new Error("source bot has no version");

    const created = await this.deps.bots.create({
      ownerId: input.ownerId,
      name: `${src.name}-copy`,
      description: src.description,
      clonedFromBotId: src.id,
    });
    const sha = createHash("sha256").update(srcVersion.code).digest("hex");
    const version = await this.deps.bots.saveVersion({
      botId: created.id,
      code: srcVersion.code,
      language: srcVersion.language,
      isRunnable: srcVersion.isRunnable,
      validationLog: srcVersion.validationLog,
      sha256: sha,
    });
    await this.deps.bots.setCurrentVersion(created.id, version.id);
    return { botId: created.id };
  }
}
