import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  botVersions,
  desc,
  eq,
  getDb,
  matches,
  matchParticipants,
  matchReplays,
  ratings,
} from "@arena/db";
import { runMatch, spawnSandboxedBot, type BotEntry } from "@arena/runner";
import { INITIAL_RATING, updateMatchRatings } from "@arena/rating";
import { publishTick, endChannel } from "./broadcaster.ts";

const HARNESS_PATHS = [
  "bots/runtime/harness.js",
  "../bots/runtime/harness.js",
  "../../bots/runtime/harness.js",
];

function findHarness(): string {
  const cwd = process.cwd();
  for (const p of HARNESS_PATHS) {
    const abs = join(cwd, p);
    if (existsSync(abs)) return abs;
  }
  // Container path inside the Docker image.
  return "/app/bots/runtime/harness.js";
}

interface PreparedBot {
  botEntry: BotEntry;
  botId: string;
  botVersionId: string;
  sandboxDir: string;
  cleanup: () => void;
}

async function prepareBot(botId: string): Promise<PreparedBot | null> {
  const db = getDb();
  const [version] = await db
    .select()
    .from(botVersions)
    .where(eq(botVersions.botId, botId))
    .orderBy(desc(botVersions.uploadedAt))
    .limit(1);
  if (!version || !version.isRunnable) return null;

  const dir = mkdtempSync(join(tmpdir(), `arena-bot-${botId.slice(0, 8)}-`));
  const harnessSrc = findHarness();
  const harnessPath = join(dir, "harness.js");
  if (existsSync(harnessSrc)) copyFileSync(harnessSrc, harnessPath);
  const scriptPath = join(dir, "bot.js");
  writeFileSync(scriptPath, version.code, "utf8");

  return {
    botId,
    botVersionId: version.id,
    sandboxDir: dir,
    botEntry: { id: botId, scriptPath, harnessPath, sandboxDir: dir },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Run a single pending match: prepare bot subprocesses, run engine, persist replay,
 * update ratings if it's a ranked match.
 */
export async function runOneMatch(matchId: string): Promise<void> {
  const db = getDb();
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) return;

  await db.update(matches).set({ status: "running", startedAt: new Date() }).where(eq(matches.id, matchId));

  const participants = await db.select().from(matchParticipants).where(eq(matchParticipants.matchId, matchId));
  const prepared: PreparedBot[] = [];
  for (const p of participants) {
    const pb = await prepareBot(p.botId);
    if (pb) prepared.push(pb);
  }

  if (prepared.length < 2) {
    await db.update(matches).set({ status: "failed", finishedAt: new Date() }).where(eq(matches.id, matchId));
    return;
  }

  try {
    const replay = await runMatch({
      bots: prepared.map((p) => p.botEntry),
      seed: match.seed,
      spawn: spawnSandboxedBot,
      onTick: async (tick) => {
        publishTick(matchId, tick);
        // Pace ticks for live spectators (~700ms floor).
        await new Promise<void>((r) => setTimeout(r, 700));
      },
    });

    // Persist replay.
    await db.insert(matchReplays).values({ matchId, ticks: replay.ticks }).onConflictDoNothing();

    // Update participants with placement / final HP.
    const finalById = new Map(replay.finalPlacements.map((p) => [p.botId, p.placement]));
    const lastSnap = replay.ticks[replay.ticks.length - 1]?.worldSnapshot.bots ?? [];
    const hpById = new Map(lastSnap.map((b) => [b.id, b.hp]));
    for (const p of prepared) {
      await db.update(matchParticipants).set({
        placement: finalById.get(p.botId) ?? null,
        finalHp: hpById.get(p.botId) ?? 0,
      }).where(eq(matchParticipants.matchId, matchId));
    }

    // Update ratings if ranked.
    if (match.kind === "auto" && match.seasonId) {
      const ratingRows = await db
        .select()
        .from(ratings)
        .where(eq(ratings.seasonId, match.seasonId));
      const existing = new Map(ratingRows.map((r) => [r.botId, r]));
      const inputs = prepared.map((p) => ({
        botId: p.botId,
        rating: existing.get(p.botId)
          ? { rating: existing.get(p.botId)!.rating, rd: existing.get(p.botId)!.rd, vol: existing.get(p.botId)!.vol }
          : { ...INITIAL_RATING },
        placement: finalById.get(p.botId) ?? prepared.length,
      }));
      const updated = updateMatchRatings(inputs);
      for (const [botId, g] of updated) {
        const before = existing.get(botId);
        await db
          .insert(ratings)
          .values({
            botId,
            seasonId: match.seasonId,
            rating: g.rating,
            rd: g.rd,
            vol: g.vol,
            games: (before?.games ?? 0) + 1,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [ratings.botId, ratings.seasonId],
            set: { rating: g.rating, rd: g.rd, vol: g.vol, games: (before?.games ?? 0) + 1, updatedAt: new Date() },
          });
        const delta = g.rating - (before?.rating ?? INITIAL_RATING.rating);
        await db
          .update(matchParticipants)
          .set({ ratingDelta: delta })
          .where(eq(matchParticipants.matchId, matchId));
      }
    }

    await db
      .update(matches)
      .set({ status: "done", finishedAt: new Date() })
      .where(eq(matches.id, matchId));
  } catch (err) {
    console.error(`match ${matchId} failed:`, err);
    await db
      .update(matches)
      .set({ status: "failed", finishedAt: new Date() })
      .where(eq(matches.id, matchId));
  } finally {
    endChannel(matchId);
    for (const p of prepared) p.cleanup();
  }
}

/** Find pending matches that are ready to run. */
export async function pickPendingMatches(limit: number): Promise<string[]> {
  const db = getDb();
  const list = await db
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.status, "pending"))
    .limit(limit);
  return list.map((m) => m.id);
}
