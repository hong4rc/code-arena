import { createHash } from "node:crypto";

import type { BotRepo, ValidationIssue, Validator } from "../../ports/index.ts";

export interface SaveBotInput {
  ownerId: string;
  /** If set, save a new version under an existing bot owned by this user. */
  botId?: string;
  name: string;
  code: string;
}

export interface SaveBotResult {
  ok: boolean;
  botId: string;
  versionId: string;
  issues: ValidationIssue[];
  stderr?: string;
}

export interface SaveBotDeps {
  bots: BotRepo;
  validator: Validator;
}

/** Validate user-submitted bot code, persist a new version, mark the bot runnable when valid. */
export class SaveBotUseCase {
  constructor(private deps: SaveBotDeps) {}

  async execute(input: SaveBotInput): Promise<SaveBotResult> {
    const validation = await this.deps.validator.validate(input.code);

    let botId = input.botId;
    if (botId) {
      await this.deps.bots.rename(botId, input.name);
    } else {
      const created = await this.deps.bots.create({ ownerId: input.ownerId, name: input.name });
      botId = created.id;
    }

    const sha = createHash("sha256").update(input.code).digest("hex");
    const version = await this.deps.bots.saveVersion({
      botId,
      code: input.code,
      language: "js",
      isRunnable: validation.ok,
      validationLog: validation.issues,
      sha256: sha,
    });

    if (validation.ok) {
      await this.deps.bots.setCurrentVersion(botId, version.id);
    }

    return {
      ok: validation.ok,
      botId,
      versionId: version.id,
      issues: validation.issues,
      ...(validation.stderr ? { stderr: validation.stderr } : {}),
    };
  }
}
