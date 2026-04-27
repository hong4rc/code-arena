/* eslint-disable no-console */
// Aggregate balance stats across all finished matches. One-off script:
//   bun run stats
// Reads `matches`, `match_participants`, `match_replays`, `bots` directly and
// prints a console summary — no metrics tables, no extra writes.
import { eq, inArray } from "drizzle-orm";

import { getDb } from "./index.ts";
import { bots, matchParticipants, matchReplays, matches } from "./schema.ts";

interface ResolvedAction {
  botId: string;
  attempted: { type: string };
  applied: { type: string };
  reason?: string;
}
interface BotSnap { id: string; hp: number; alive: boolean; inventory: string[] }
interface TickReplay {
  tick: number;
  actions?: ResolvedAction[];
  worldSnapshot: { bots: BotSnap[]; items: { kind: string }[] };
}

const db = getDb();

console.log("Loading matches…");
const finished = await db.select().from(matches).where(eq(matches.status, "done"));
console.log(`  ${finished.length} done matches`);

if (finished.length === 0) {
  console.log("No finished matches — run a few first.");
  process.exit(0);
}

const matchIds = finished.map((m) => m.id);
const replays = await db.select().from(matchReplays).where(inArray(matchReplays.matchId, matchIds));
const replayById = new Map<string, TickReplay[]>();
for (const r of replays) replayById.set(r.matchId, r.ticks as TickReplay[]);

const parts = await db.select().from(matchParticipants).where(inArray(matchParticipants.matchId, matchIds));
const partsByMatch = new Map<string, typeof parts>();
for (const p of parts) {
  const list = partsByMatch.get(p.matchId) ?? [];
  list.push(p);
  partsByMatch.set(p.matchId, list);
}

const botRows = await db.select().from(bots);
const botName = new Map(botRows.map((b) => [b.id, b.name]));

// ─── aggregates ─────────────────────────────────────────────────────────
const actionCounts: Record<string, number> = {};
const failureReasons: Record<string, number> = {};
let totalTicks = 0;
let totalActions = 0;
let totalDeaths = 0;
let totalKillsByMelee = 0;     // ATTACK action one tick before HP→0
let totalKillsByRanged = 0;    // SHOOT followed by death (rough)
let totalKillsByZone = 0;      // HP→0 with no ATTACK/SHOOT in same tick
const itemsHeldAtDeath: Record<string, number> = {};

// per-bot
interface BotAgg {
  matches: number; wins: number; sumPlacement: number; sumDmg: number;
  sumPicks: number; sumRatingDelta: number; ratingMatches: number;
}
const perBot = new Map<string, BotAgg>();
function bumpBot(id: string, fn: (a: BotAgg) => void) {
  let a = perBot.get(id);
  if (!a) { a = { matches: 0, wins: 0, sumPlacement: 0, sumDmg: 0, sumPicks: 0, sumRatingDelta: 0, ratingMatches: 0 }; perBot.set(id, a); }
  fn(a);
}

for (const m of finished) {
  const ticks = replayById.get(m.id) ?? [];
  totalTicks += ticks.length;
  let prevAlive = new Map<string, boolean>();
  for (const t of ticks) {
    for (const a of t.actions ?? []) {
      totalActions += 1;
      actionCounts[a.applied.type] = (actionCounts[a.applied.type] ?? 0) + 1;
      if (a.reason) failureReasons[a.reason] = (failureReasons[a.reason] ?? 0) + 1;
    }
    // Detect deaths this tick.
    for (const b of t.worldSnapshot.bots) {
      const wasAlive = prevAlive.get(b.id) ?? true;
      if (wasAlive && !b.alive) {
        totalDeaths += 1;
        for (const item of b.inventory) {
          itemsHeldAtDeath[item] = (itemsHeldAtDeath[item] ?? 0) + 1;
        }
        const hadShoot = (t.actions ?? []).some((a) => a.applied.type === "SHOOT");
        const hadAttack = (t.actions ?? []).some((a) => a.applied.type === "ATTACK");
        if (hadShoot) totalKillsByRanged += 1;
        else if (hadAttack) totalKillsByMelee += 1;
        else totalKillsByZone += 1;
      }
    }
    prevAlive = new Map(t.worldSnapshot.bots.map((b) => [b.id, b.alive]));
  }

  for (const p of partsByMatch.get(m.id) ?? []) {
    bumpBot(p.botId, (a) => {
      a.matches += 1;
      if (p.placement === 1) a.wins += 1;
      a.sumPlacement += p.placement ?? 0;
      a.sumDmg += p.damageDealt;
      a.sumPicks += p.itemsPicked;
      if (p.ratingDelta !== null && p.ratingDelta !== undefined) { a.sumRatingDelta += p.ratingDelta; a.ratingMatches += 1; }
    });
  }
}

// ─── output ─────────────────────────────────────────────────────────────
function pct(n: number, d: number): string {
  if (d === 0) return "0.0%";
  return ((n / d) * 100).toFixed(1) + "%";
}
function row(label: string, value: string | number) {
  console.log(`  ${label.padEnd(24)} ${value}`);
}
function header(s: string) { console.log(`\n── ${s} ${"─".repeat(Math.max(0, 60 - s.length - 4))}`); }

header("Matches");
row("total finished", finished.length);
row("avg ticks/match", (totalTicks / finished.length).toFixed(1));
row("total actions", totalActions);
row("total deaths", totalDeaths);

header("Action mix (% of all actions)");
for (const [type, n] of Object.entries(actionCounts).sort((a, b) => b[1] - a[1])) {
  row(type, `${n}  (${pct(n, totalActions)})`);
}

header("Kill source");
const totalKills = totalKillsByMelee + totalKillsByRanged + totalKillsByZone;
row("ranged (SHOOT)", `${totalKillsByRanged}  (${pct(totalKillsByRanged, totalKills)})`);
row("melee (ATTACK)", `${totalKillsByMelee}  (${pct(totalKillsByMelee, totalKills)})`);
row("zone / other",   `${totalKillsByZone}  (${pct(totalKillsByZone, totalKills)})`);

header("Items held at death");
for (const [k, n] of Object.entries(itemsHeldAtDeath).sort((a, b) => b[1] - a[1])) {
  row(k, `${n}  (${pct(n, totalDeaths)} of deaths)`);
}

header("Failed-action reasons (top 10)");
for (const [r, n] of Object.entries(failureReasons).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  row(r, n);
}

header("Per-bot leaderboard (sorted by win rate)");
const ranked = [...perBot.entries()]
  .map(([id, a]) => ({
    name: botName.get(id) ?? id.slice(0, 8),
    matches: a.matches,
    winRate: a.matches > 0 ? a.wins / a.matches : 0,
    avgPlacement: a.matches > 0 ? a.sumPlacement / a.matches : 0,
    avgDmg: a.matches > 0 ? a.sumDmg / a.matches : 0,
    avgPicks: a.matches > 0 ? a.sumPicks / a.matches : 0,
    avgRatingDelta: a.ratingMatches > 0 ? a.sumRatingDelta / a.ratingMatches : 0,
  }))
  .filter((r) => r.matches >= 1)
  .sort((a, b) => b.winRate - a.winRate);

console.log(`  ${"name".padEnd(20)} ${"games".padStart(6)} ${"win%".padStart(7)} ${"avgPlace".padStart(9)} ${"avgDmg".padStart(8)} ${"picks".padStart(6)} ${"ΔR".padStart(8)}`);
for (const r of ranked) {
  console.log(
    `  ${r.name.padEnd(20)} ${String(r.matches).padStart(6)}` +
    ` ${(r.winRate * 100).toFixed(1).padStart(6)}%` +
    ` ${r.avgPlacement.toFixed(2).padStart(9)}` +
    ` ${r.avgDmg.toFixed(0).padStart(8)}` +
    ` ${r.avgPicks.toFixed(1).padStart(6)}` +
    ` ${(r.avgRatingDelta >= 0 ? "+" : "") + r.avgRatingDelta.toFixed(1)}`.padStart(9),
  );
}

console.log("");
process.exit(0);
