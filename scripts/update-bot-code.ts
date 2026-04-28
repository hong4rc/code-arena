#!/usr/bin/env bun
/* eslint-disable no-console */
// Update a DB bot's code WITHOUT resetting bot_params. Use when only the
// rules / behavior layer changed and the NN architecture (input shape +
// weights count) is the same — trained weights stay valid.
//
// Use `upgrade-bot.ts` instead if the architecture changed (different
// weight count, new layer sizes), since old weights wouldn't load cleanly.
//
// Usage:
//   bun scripts/update-bot-code.ts --db-bot-id <uuid> --code bots/samples/nn-bot.js
//   bun scripts/update-bot-code.ts --db-bot-ids id1,id2,id3 --code path.js
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { DrizzleBotRepo } from "@arena/adapters";
import { botVersions, bots, getDb } from "@arena/db";

const args = process.argv.slice(2);
function arg(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const ids = (arg("--db-bot-ids") ?? arg("--db-bot-id") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const codePath = arg("--code");
if (ids.length === 0 || !codePath) {
  console.error("Usage: bun scripts/update-bot-code.ts --db-bot-ids id1,id2,... --code <path.js>");
  process.exit(2);
}

const code = readFileSync(resolve(codePath), "utf8");
const sha = createHash("sha256").update(code).digest("hex");
const db = getDb();
const botRepo = new DrizzleBotRepo();

console.log(`Updating ${ids.length} bot(s) to ${codePath} (sha ${sha.slice(0, 12)})…`);

for (const id of ids) {
  const bot = await botRepo.findById(id);
  if (!bot) { console.warn(`  ✗ ${id} — not found`); continue; }
  const [v] = await db.insert(botVersions).values({
    botId: id,
    code,
    language: "js",
    isRunnable: true,
    sha256: sha,
  }).returning();
  await db.update(bots).set({ currentVersionId: v!.id }).where(eq(bots.id, id));
  console.log(`  ✓ ${bot.name.padEnd(12)} new version ${v!.id.slice(0, 8)}  (params kept intact)`);
}

console.log("\nDone. Trainer will pick up the new code on its next round (~6 min).");
process.exit(0);
