#!/usr/bin/env bun
/* eslint-disable no-console */
// Create N new bots cloned from a template file, owned by a given user,
// flagged as training targets, runnable from tick 0. Used to expand the
// training pool without going through the web editor.
//
// Usage:
//   bun scripts/spawn-trainees.ts \
//     --owner <user-uuid> \
//     --code  bots/samples/nn-bot.js \
//     --names hong3,hong4
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import { DrizzleBotRepo } from "@arena/adapters";
import { botParams, botVersions, bots, getDb, sql } from "@arena/db";
import { eq } from "drizzle-orm";

const args = process.argv.slice(2);
function arg(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const owner = arg("--owner");
const codePath = arg("--code");
const names = (arg("--names") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!owner || !codePath || names.length === 0) {
  console.error("Usage: bun scripts/spawn-trainees.ts --owner <uuid> --code <path.js> --names a,b,c");
  process.exit(2);
}

const code = readFileSync(resolve(codePath), "utf8");
const sha = createHash("sha256").update(code).digest("hex");
const db = getDb();
const botRepo = new DrizzleBotRepo();

console.log(`Spawning ${names.length} trainees from ${codePath} for owner ${owner.slice(0, 8)}…`);

for (const name of names) {
  const bot = await botRepo.create({
    ownerId: owner,
    name,
    description: `Training-target clone of ${codePath.split("/").pop()}`,
    isPublic: false,
    isOfficial: false,
  });
  const [v] = await db.insert(botVersions).values({
    botId: bot.id,
    code,
    language: "js",
    isRunnable: true,
    sha256: sha,
  }).returning();
  await db.update(bots).set({
    currentVersionId: v!.id,
    isTrainingTarget: true,
  }).where(eq(bots.id, bot.id));
  // Seed an empty params row so the trainer's first round starts cleanly.
  await db.insert(botParams).values({
    botId: bot.id,
    version: sql<number>`coalesce((select max(version) from ${botParams} where bot_id = ${bot.id}), 0) + 1`,
    params: {},
  });
  console.log(`  ✓ ${name.padEnd(12)} ${bot.id}`);
}

console.log("\nDone. The deployed trainer will pick them up on its next round (~10 s).");
process.exit(0);
