/* eslint-disable no-console */
// Wipe match-related data and re-seed sample bots. One-off ops command.
//
// Usage:
//   bun run reset                    — wipe matches/ratings/queue/params, keep bots, re-seed
//   bun run reset --user-bots        — also delete every non-official bot (clones, user uploads)
//   bun run reset --keep-seed        — skip the re-seed step at the end
//   bun run reset --confirm-prod     — required when DATABASE_URL points at production
//
// Cascades: deleting a `match` removes its participants + replay rows automatically
// (FK ON DELETE CASCADE). Deleting a `bot` removes its versions, ratings, queue
// entries, match_participants, and bot_params rows.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { eq, sql } from "drizzle-orm";

import { getDb } from "./index.ts";
import { botParams, bots, matchQueue, matchReplays, matchParticipants, matches, ratings } from "./schema.ts";

const args = new Set(process.argv.slice(2));
const wipeUserBots = args.has("--user-bots");
const skipSeed = args.has("--keep-seed");
const confirmedProd = args.has("--confirm-prod");

const dbUrl = process.env.DATABASE_URL ?? "";
const looksLikeProd = /(\bprod\b|prd\.|production)/i.test(dbUrl);
if (looksLikeProd && !confirmedProd) {
  console.error("DATABASE_URL looks like a production URL. Re-run with --confirm-prod if you really mean it.");
  process.exit(1);
}

const db = getDb();
console.log(`Resetting ${dbUrl.replaceAll(/:[^:@]+@/g, ":***@")}`);

// 1. Match-related data — order matters because some tables don't cascade FROM matches
//    (replays + participants do, but be explicit so the script remains correct
//    if cascade rules ever change).
const removed = {
  replays: 0, participants: 0, matches: 0,
  ratings: 0, queue: 0, params: 0, bots: 0,
};
const wiped = {
  replays:      await db.delete(matchReplays).returning({ id: matchReplays.matchId }),
  participants: await db.delete(matchParticipants).returning({ id: matchParticipants.botId }),
  matches:      await db.delete(matches).returning({ id: matches.id }),
  ratings:      await db.delete(ratings).returning({ id: ratings.botId }),
  queue:        await db.delete(matchQueue).returning({ id: matchQueue.botId }),
  params:       await db.delete(botParams).returning({ id: botParams.id }),
};
for (const [k, rows] of Object.entries(wiped)) (removed as Record<string, number>)[k] = rows.length;

// 2. Optionally delete every non-official bot. Cascades remove their versions
//    + any leftover queue/rating/param rows that didn't already get caught above.
if (wipeUserBots) {
  const userBots = await db.delete(bots).where(eq(bots.isOfficial, false)).returning({ id: bots.id });
  removed.bots = userBots.length;
}

console.log("Wiped:");
for (const [k, n] of Object.entries(removed)) console.log(`  ${k.padEnd(14)} ${n}`);

// 3. Re-seed sample bots. Spawn the existing seed script so we don't fork the logic.
if (!skipSeed) {
  console.log("\nRe-seeding sample bots…");
  const seedPath = join(import.meta.dir, "seed.ts");
  const r = spawnSync("bun", [seedPath], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("seed.ts failed");
    process.exit(r.status ?? 1);
  }
}

// 4. Sanity check.
const [botRow] = await db.select({ count: sql<number>`count(*)::int` }).from(bots);
const [matchRow] = await db.select({ count: sql<number>`count(*)::int` }).from(matches);
console.log(`\nFinal state: ${botRow?.count ?? 0} bots, ${matchRow?.count ?? 0} matches.`);
process.exit(0);
