#!/usr/bin/env bun
/* eslint-disable no-console */
// Upgrade a DB bot's code to a sample file's contents AND reset its
// bot_params (since architecture changes invalidate old weights).
//
// Usage:
//   bun scripts/upgrade-bot.ts --db-bot-id <uuid> --code bots/samples/nn-bot.js
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { DrizzleBotRepo } from "@arena/adapters";
import { botParams, botVersions, bots, getDb } from "@arena/db";

const args = process.argv.slice(2);
function arg(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const id = arg("--db-bot-id");
const codePath = arg("--code");
if (!id || !codePath) {
  console.error("Usage: bun scripts/upgrade-bot.ts --db-bot-id <uuid> --code <path.js>");
  process.exit(2);
}

const code = readFileSync(resolve(codePath), "utf8");
const sha = createHash("sha256").update(code).digest("hex");
const db = getDb();

const botRepo = new DrizzleBotRepo();
const bot = await botRepo.findById(id);
if (!bot) { console.error(`No bot ${id}`); process.exit(3); }

console.log(`Upgrading bot "${bot.name}" (${id.slice(0, 8)})`);
console.log(`  new code: ${codePath} (${code.split("\n").length} lines, sha256 ${sha.slice(0, 12)})`);

// Insert a new immutable version row, point currentVersionId at it.
const [v] = await db.insert(botVersions).values({
  botId: id,
  code,
  language: "js",
  isRunnable: true,
  sha256: sha,
}).returning();
await db.update(bots).set({ currentVersionId: v!.id }).where(eq(bots.id, id));
console.log(`  saved bot_versions ${v!.id.slice(0, 8)} → currentVersion`);

// Append a fresh empty params blob — old versions stay (audit/rollback) but
// the new "latest" reads as empty so the trainer + bot both reinitialise
// cleanly under the new architecture.
const { sql } = await import("drizzle-orm");
const [reset] = await db.insert(botParams).values({
  botId: id,
  version: sql<number>`coalesce((select max(version) from ${botParams} where bot_id = ${id}), 0) + 1`,
  params: {},
}).returning({ version: botParams.version });
console.log(`  saved fresh bot_params v${reset!.version} = {} (old rows preserved)`);

console.log("Done. Run `bun run train --db-bot-id " + id + " --matches 500` to retrain.");
process.exit(0);
