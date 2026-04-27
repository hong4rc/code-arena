import { createHash } from "node:crypto";

import { bots, botVersions, eq, getDb } from "@arena/db";
import { validateBot } from "@arena/validation";

export interface SaveBotInput {
  ownerId: string;
  botId?: string;
  name: string;
  code: string;
}

export interface SaveBotResult {
  ok: boolean;
  botId: string;
  versionId?: string;
  issues: { level: string; code: string; message: string }[];
}

export async function saveBot(input: SaveBotInput): Promise<SaveBotResult> {
  const validation = await validateBot(input.code);

  const db = getDb();
  let botId = input.botId;
  if (botId) {
    await db.update(bots).set({ name: input.name }).where(eq(bots.id, botId));
  } else {
    const [created] = await db
      .insert(bots)
      .values({ ownerId: input.ownerId, name: input.name })
      .returning();
    botId = created!.id;
  }

  const sha = createHash("sha256").update(input.code).digest("hex");
  const [version] = await db
    .insert(botVersions)
    .values({
      botId,
      code: input.code,
      language: "js",
      isRunnable: validation.ok,
      validationLog: validation.issues,
      sha256: sha,
    })
    .returning();

  if (validation.ok) {
    await db.update(bots).set({ currentVersionId: version!.id }).where(eq(bots.id, botId));
  }

  return {
    ok: validation.ok,
    botId,
    versionId: version!.id,
    issues: validation.issues,
  };
}
