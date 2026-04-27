/* eslint-disable no-console */
import {
  and,
  bots,
  botVersions,
  desc,
  eq,
  getDb,
  inArray,
  matchParticipants,
  matchQueue,
  matches,
  ratings,
  seasons,
} from "@arena/db";

const CYCLE_MS = 5 * 60 * 1000;
const MATCHES_PER_CYCLE = 3;
const MATCH_SIZE = 10;
const MIN_BOTS_TO_RUN = MATCH_SIZE * 2;

/** Pick N bots with similar rating from a pool. */
function pickBand(pool: { botId: string; rating: number }[], n: number): string[] {
  if (pool.length < n) return [];
  // Sort ascending by rating; pick a random window of size n.
  pool.sort((a, b) => a.rating - b.rating);
  const start = Math.floor(Math.random() * (pool.length - n + 1));
  return pool.slice(start, start + n).map((p) => p.botId);
}

function pickRandom(pool: { botId: string }[], n: number): string[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, n).map((p) => p.botId);
}

/** Build candidate pool (queue + active runnable bots). */
async function candidatePool(seasonId: string): Promise<{ botId: string; rating: number; queued: boolean }[]> {
  const db = getDb();
  // Active bots: non-official, with a current runnable version.
  const activeRows = await db
    .select({ botId: bots.id, currentVersionId: bots.currentVersionId })
    .from(bots)
    .where(eq(bots.isOfficial, false));
  const activeIds = activeRows.filter((r) => r.currentVersionId !== null).map((r) => r.botId);

  // Queue.
  const queueRows = await db.select().from(matchQueue);
  const queueIds = new Set(queueRows.map((r) => r.botId));

  // Ratings (default 1500).
  const ratingRows = activeIds.length
    ? await db.select().from(ratings).where(and(eq(ratings.seasonId, seasonId), inArray(ratings.botId, activeIds)))
    : [];
  const ratingMap = new Map(ratingRows.map((r) => [r.botId, r.rating]));

  return activeIds.map((id) => ({ botId: id, rating: ratingMap.get(id) ?? 1500, queued: queueIds.has(id) }));
}

/** Run one matchmaking cycle. Returns number of matches created. */
export async function runMatchmakingCycle(): Promise<number> {
  const db = getDb();
  const [season] = await db.select().from(seasons).where(eq(seasons.isActive, true)).limit(1);
  if (!season) {
    console.log("[scheduler] no active season — skipping cycle");
    return 0;
  }

  let pool = await candidatePool(season.id);
  pool = pool.filter((p) => p.botId); // only bots with a current version
  if (pool.length < MIN_BOTS_TO_RUN) {
    console.log(`[scheduler] only ${pool.length} bots — need ${MIN_BOTS_TO_RUN}`);
    return 0;
  }

  let created = 0;
  for (let m = 0; m < MATCHES_PER_CYCLE; m++) {
    if (pool.length < MATCH_SIZE) break;
    let picked: string[];
    if (m < 2) {
      const queueFirst = pool.filter((p) => p.queued);
      const rest = pool.filter((p) => !p.queued);
      picked = pickBand([...queueFirst, ...rest].slice(0, Math.max(MATCH_SIZE * 3, queueFirst.length)), MATCH_SIZE);
    } else {
      picked = pickRandom(pool, MATCH_SIZE);
    }
    if (picked.length < MATCH_SIZE) break;
    pool = pool.filter((p) => !picked.includes(p.botId));

    const seed = Math.floor(Math.random() * 0x7fffffff);
    const [match] = await db
      .insert(matches)
      .values({ seasonId: season.id, kind: "auto", status: "pending", seed })
      .returning();
    for (const botId of picked) {
      const [v] = await db
        .select()
        .from(botVersions)
        .where(and(eq(botVersions.botId, botId), eq(botVersions.isRunnable, true)))
        .orderBy(desc(botVersions.uploadedAt))
        .limit(1);
      if (!v) continue;
      await db.insert(matchParticipants).values({
        matchId: match!.id,
        botId,
        botVersionId: v.id,
      });
    }
    // Drain these bots from queue.
    if (picked.length) {
      await db.delete(matchQueue).where(inArray(matchQueue.botId, picked));
    }
    created += 1;
  }
  console.log(`[scheduler] created ${created} matches`);
  return created;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (timer) return;
  console.log("[scheduler] starting (cycle = 5min)");
  // First cycle after 30s, then every 5 min.
  setTimeout(() => {
    void runMatchmakingCycle().catch((e) => console.error("[scheduler]", e));
  }, 30_000);
  timer = setInterval(() => {
    void runMatchmakingCycle().catch((e) => console.error("[scheduler]", e));
  }, CYCLE_MS);
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
