/* eslint-disable no-console */
// Seed: system user + 4 official sample bots + initial season.
// Idempotent — safe to run multiple times.
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import { getDb } from "./index.ts";
import { bots, botVersions, seasons, users } from "./schema.ts";

const SAMPLES = [
  { name: "random-bot", file: "bots/samples/random-bot.js", description: "Picks a random valid action each tick." },
  { name: "greedy-bot", file: "bots/samples/greedy-bot.js", description: "Heads for the nearest item, attacks adjacent enemies." },
  { name: "defensive-bot", file: "bots/samples/defensive-bot.js", description: "Heals at low HP, flees from enemies, grabs items if safe." },
  { name: "hunter-bot", file: "bots/samples/hunter-bot.js", description: "Stalks the lowest-HP visible enemy." },
  { name: "survivor-bot", file: "bots/samples/survivor-bot.js", description: "Adapts to game phase — early loot, late combat." },
  { name: "zone-bot", file: "bots/samples/zone-bot.js", description: "Zone-runner — always heads for the safest cell. Avoids fights." },
  { name: "god-bot", file: "bots/samples/god-bot.js", description: "Best-of-class baseline — leads bullet shots, dodges, kites, full loot economy." },
  { name: "nn-bot", file: "bots/samples/nn-bot.js", description: "Neural-network brain (40→32→24→15). Self-evolves weights via (1+1)-ES across matches." },
];

function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(cur, "bots/samples"))) return cur;
    cur = join(cur, "..");
  }
  throw new Error("could not locate bots/samples — run from the repo root");
}

const repoRoot = findRepoRoot(process.cwd());
const db = getDb();

console.log("Seeding…");

// 1. System user (owns the official sample bots). Looked up by email so this
// is idempotent across reseeds; the id is auto-generated UUIDv7.
let [system] = await db.select().from(users).where(eq(users.email, "system@arena.local")).limit(1);
if (!system) {
  [system] = await db
    .insert(users)
    .values({
      email: "system@arena.local",
      emailVerified: true,
      name: "Arena",
      role: "admin",
    })
    .returning();
  console.log("  created system user");
}

// 2. Active season.
const [existingSeason] = await db.select().from(seasons).where(eq(seasons.isActive, true)).limit(1);
if (!existingSeason) {
  await db.insert(seasons).values({ name: "Season 1", isActive: true, startedAt: new Date() });
  console.log("  created Season 1");
}

// 3. Sample bots — upsert by (ownerId=system, name).
for (const s of SAMPLES) {
  const code = readFileSync(join(repoRoot, s.file), "utf8");
  const sha = createHash("sha256").update(code).digest("hex");
  const [existing] = await db
    .select()
    .from(bots)
    .where(eq(bots.name, s.name))
    .limit(1);
  let botId: string;
  if (existing && existing.ownerId === system!.id) {
    botId = existing.id;
  } else {
    const [created] = await db
      .insert(bots)
      .values({
        ownerId: system!.id,
        name: s.name,
        description: s.description,
        isOfficial: true,
        isPublic: true,
      })
      .returning();
    botId = created!.id;
  }
  // Insert a version if sha differs from latest.
  const [v] = await db.insert(botVersions).values({
    botId,
    code,
    language: "js",
    isRunnable: true,
    sha256: sha,
  }).returning();
  await db.update(bots).set({ currentVersionId: v!.id }).where(eq(bots.id, botId));
  console.log(`  seeded ${s.name}`);
}

console.log("Done.");
process.exit(0);
