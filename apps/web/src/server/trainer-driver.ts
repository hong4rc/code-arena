/* eslint-disable no-console */
// In-process trainer. Runs alongside the scheduler in the main Next.js
// server — no separate worker / dyno needed (Render free tier has no workers).
//
// Behavior:
//   • Polls the bots table for `is_training_target=true` (toggleable from the
//     admin UI at /admin/training).
//   • For each flagged bot: load its latest code + params, play a round of
//     local matches against a sampled set of OTHER live bots, evolve weights
//     via (1+1)-ES, persist a new bot_params row.
//   • Opponents' params are read but never written. The trainer never touches
//     `matches`, `match_replays`, `match_participants`, `ratings`, or queue.
//
// All env vars are optional; sensible defaults below.
import { SubprocessSandbox } from "@arena/adapters";
import { runMatchEngine } from "@arena/application";
import type { BotProcess } from "@arena/application";

import { composition } from "@/composition";

const cfg = {
  envBotIds: (process.env.TRAINER_BOT_IDS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean),
  // Defaults tuned for Render free 512 MB — fast rotation across all flagged
  // bots while staying under memory budget, with each match long enough for
  // real zone-collapse / bullet-trade dynamics.
  opponentPoolSize: Number(process.env.TRAINER_OPPONENT_POOL_SIZE ?? 3),  // 4-bot match (1 trainee + 3 opp); ~280 MB peak
  includeOfficial: process.env.TRAINER_INCLUDE_OFFICIAL !== "0",
  matchesPerRound: Number(process.env.TRAINER_MATCHES_PER_ROUND ?? 12),   // ~30s per round vs ~75s before
  sigma: Number(process.env.TRAINER_SIGMA ?? 0.04),
  sigmaMax: Number(process.env.TRAINER_SIGMA_MAX ?? 0.1),                 // tighter cap, less wandering after a noisy promotion
  batch: Number(process.env.TRAINER_BATCH ?? 6),                          // ES decision every 6 matches (was 12); faster adapt
  mutationRate: Number(process.env.TRAINER_MUTATION_RATE ?? 0.08),
  ticks: Number(process.env.TRAINER_TICKS ?? 600),                        // 67% of full 900-tick prod match — full zone cycle
  sleepMs: Number(process.env.TRAINER_SLEEP_MS ?? 5000),                  // shorter idle between rounds
  reloadEvery: Number(process.env.TRAINER_RELOAD_TARGETS_EVERY ?? 2),     // re-poll DB every other round, less query churn
};

const SIGMA_MIN = 0.01;
const SIGMA_DECAY = 0.85;
const SIGMA_GROW = 1.2;
const EXCLUDE_KEYS = new Set(["matchesPlayed", "evals", "score", "scores", "recent", "experiment"]);
const TRAINEE_ID = "trainee";

interface OpponentBot { botId: string; name: string; code: string; params: unknown }
interface TraineeState {
  botId: string;
  name: string;
  code: string;
  champion: unknown;
  candidate: unknown;
  candidateScores: number[];
  champBaseline: number;
  sigma: number;
  totalRounds: number;
  totalMatches: number;
  totalWins: number;
  // Hourly-report deltas — reset whenever a report fires.
  hourMatches: number;
  hourWins: number;
  hourPromotions: number;
  hourBaselineStart: number;
  hourSigmaStart: number;
}

const REPORT_INTERVAL_MS = Number(process.env.TRAINER_REPORT_INTERVAL_MS ?? 60 * 60 * 1000);
let lastReportAt = Date.now();

let running = false;
let stopFlag = false;
let trainees: TraineeState[] = [];
let roundsSinceReload = Number.POSITIVE_INFINITY;

const sandbox = new SubprocessSandbox();

export function startTrainerDriver(): void {
  if (running) return;
  if (cfg.envBotIds.length === 0 && !process.env.DATABASE_URL) {
    console.log("[trainer] DATABASE_URL not set — skipping");
    return;
  }
  running = true;
  console.log(`[trainer] starting (in-process)`);
  console.log(`  source: ${cfg.envBotIds.length > 0 ? `env TRAINER_BOT_IDS (${cfg.envBotIds.length})` : "DB is_training_target flag"}`);
  console.log(`  matches/round: ${cfg.matchesPerRound}  ticks: ${cfg.ticks}  sleep: ${cfg.sleepMs}ms`);
  void runForever();
}

export function stopTrainerDriver(): void {
  stopFlag = true;
}

async function runForever(): Promise<void> {
  while (!stopFlag) {
    try {
      await runOneIteration();
    } catch (error) {
      console.error("[trainer] iteration failed:", error);
    }
    if (stopFlag) break;
    await sleep(cfg.sleepMs);
  }
  running = false;
  console.log("[trainer] stopped");
}

async function runOneIteration(): Promise<void> {
  if (roundsSinceReload >= cfg.reloadEvery) {
    const fresh = await loadTargets();
    if (fresh.length === 0) {
      // Quietly idle — admin hasn't flagged any bots yet.
      trainees = [];
      roundsSinceReload = 0;
      return;
    }
    const byId = new Map(trainees.map((t) => [t.botId, t]));
    trainees = fresh.map((t) => {
      const prev = byId.get(t.botId);
      return prev
        ? { ...t, sigma: prev.sigma, champBaseline: prev.champBaseline, totalRounds: prev.totalRounds, totalMatches: prev.totalMatches, totalWins: prev.totalWins }
        : t;
    });
    if (trainees.length > 0) {
      console.log(`[trainer] training: ${trainees.map((t) => t.name).join(", ")}`);
    }
    roundsSinceReload = 0;
  }
  if (trainees.length === 0) return;

  const traineeIds = new Set(trainees.map((t) => t.botId));
  for (const state of trainees) {
    if (stopFlag) break;
    try {
      const opponents = await loadOpponents(traineeIds);
      if (opponents.length === 0) {
        console.warn("[trainer] not enough opponents — skipping round");
        continue;
      }
      // Pick up bot edits between rounds without restart.
      const ver = await composition.repos.bots.latestRunnableVersion?.(state.botId).catch(() => null);
      if (ver && ver.code !== state.code) {
        console.log(`[trainer] ${state.name} code changed — reloading`);
        state.code = ver.code;
      }
      await trainOneRound(state, opponents);
    } catch (error) {
      console.error(`[trainer] ${state.name} round failed:`, error);
    }
  }
  roundsSinceReload += 1;
  maybeEmitHourlyReport();
}

async function loadTargets(): Promise<TraineeState[]> {
  const bots = composition.repos.bots;
  const params = composition.repos.botParams;

  let targets;
  if (cfg.envBotIds.length > 0) {
    const fetched = await Promise.all(cfg.envBotIds.map((id) => bots.findById(id)));
    targets = fetched.filter((b): b is NonNullable<typeof b> => b !== null);
  } else {
    targets = await bots.findTrainingTargets();
  }

  const states: TraineeState[] = [];
  for (const bot of targets) {
    const ver = await bots.latestRunnableVersion(bot.id);
    if (!ver) { console.warn(`[trainer] skip ${bot.name} — no runnable version`); continue; }
    const row = await params.latest(bot.id);
    const champion = row?.params ?? {};
    states.push({
      botId: bot.id,
      name: bot.name,
      code: ver.code,
      champion,
      candidate: perturb(champion, cfg.sigma),
      candidateScores: [],
      champBaseline: 99,
      sigma: cfg.sigma,
      totalRounds: 0,
      totalMatches: 0,
      totalWins: 0,
      hourMatches: 0,
      hourWins: 0,
      hourPromotions: 0,
      hourBaselineStart: 99,
      hourSigmaStart: cfg.sigma,
    });
  }
  return states;
}

async function loadOpponents(excludeIds: Set<string>): Promise<OpponentBot[]> {
  const bots = composition.repos.bots;
  const params = composition.repos.botParams;

  const all = await bots.findActive();
  const candidates = all.filter((b) => !excludeIds.has(b.id) && (cfg.includeOfficial || !b.isOfficial));
  const picked = shuffle(candidates).slice(0, cfg.opponentPoolSize);

  const out: OpponentBot[] = [];
  for (const bot of picked) {
    const ver = await bots.latestRunnableVersion(bot.id);
    if (!ver) continue;
    const row = await params.latest(bot.id);
    out.push({ botId: bot.id, name: bot.name, code: ver.code, params: row?.params ?? {} });
  }
  return out;
}

async function trainOneRound(state: TraineeState, opponents: OpponentBot[]): Promise<void> {
  let wins = 0;
  let total = 0;
  for (let m = 0; m < cfg.matchesPerRound; m++) {
    if (stopFlag) break;
    const { reward, won } = await runOneMatch(state, opponents);
    state.candidateScores.push(reward);
    state.totalMatches += 1;
    state.hourMatches += 1;
    total += 1;
    if (won) {
      wins += 1;
      state.totalWins += 1;
      state.hourWins += 1;
    }

    if (state.candidateScores.length >= cfg.batch) {
      const avg = state.candidateScores.reduce((a, b) => a + b, 0) / state.candidateScores.length;
      if (avg <= state.champBaseline) {
        state.champion = state.candidate;
        state.champBaseline = avg;
        state.sigma = Math.max(SIGMA_MIN, state.sigma * SIGMA_DECAY);
        state.hourPromotions += 1;
      } else {
        state.sigma = Math.min(cfg.sigmaMax, state.sigma * SIGMA_GROW);
      }
      state.candidate = perturb(state.champion, state.sigma);
      state.candidateScores = [];
    }
  }
  if (total === 0) return;

  // Persist ONLY the trainee's params. Opponents are never written.
  const { version } = await composition.repos.botParams.saveNewVersion(state.botId, state.champion);
  state.totalRounds += 1;
  console.log(
    `[trainer] ${state.name.padEnd(16)} round=${state.totalRounds} ` +
    `match=${state.totalMatches} win=${wins}/${total} (${((wins / total) * 100).toFixed(0)}%) ` +
    `champion=${state.champBaseline.toFixed(2)} σ=${state.sigma.toFixed(3)} → bot_params v${version}`,
  );
}

function maybeEmitHourlyReport(): void {
  const elapsedMs = Date.now() - lastReportAt;
  if (elapsedMs < REPORT_INTERVAL_MS) return;
  lastReportAt = Date.now();
  if (trainees.length === 0) return;

  const minutes = (elapsedMs / 60000).toFixed(0);
  console.log(`\n[trainer] ── hourly report (last ${minutes} min) ─────────────────────`);
  console.log(`[trainer]   ${"bot".padEnd(14)} ${"matches".padStart(8)} ${"wins".padStart(6)} ${"win%".padStart(6)}  ${"promotions".padStart(11)}  ${"baseline".padStart(20)}  ${"σ".padStart(16)}`);
  for (const s of trainees) {
    const winPct = s.hourMatches === 0 ? 0 : (s.hourWins / s.hourMatches) * 100;
    const baselineDelta = s.hourBaselineStart === 99 ? `→ ${s.champBaseline.toFixed(2)}` : `${s.hourBaselineStart.toFixed(2)} → ${s.champBaseline.toFixed(2)}`;
    const sigmaDelta = `${s.hourSigmaStart.toFixed(3)} → ${s.sigma.toFixed(3)}`;
    console.log(
      `[trainer]   ${s.name.padEnd(14)} ${String(s.hourMatches).padStart(8)} ${String(s.hourWins).padStart(6)} ${winPct.toFixed(0).padStart(5)}%  ${String(s.hourPromotions).padStart(11)}  ${baselineDelta.padStart(20)}  ${sigmaDelta.padStart(16)}`,
    );
    // Reset hour counters but keep baseline/sigma snapshots up-to-date.
    s.hourMatches = 0;
    s.hourWins = 0;
    s.hourPromotions = 0;
    s.hourBaselineStart = s.champBaseline;
    s.hourSigmaStart = s.sigma;
  }
  console.log(`[trainer] ────────────────────────────────────────────────────────────\n`);
}

async function runOneMatch(state: TraineeState, opponents: OpponentBot[]): Promise<{ reward: number; won: boolean }> {
  const traineeProc = await sandbox.spawn({ botId: TRAINEE_ID, code: state.code });
  const opponentProcs = await Promise.all(
    opponents.map((o, i) => sandbox.spawn({ botId: `opp-${i}`, code: o.code })),
  );
  const procs: BotProcess[] = [traineeProc, ...opponentProcs];
  const initialParams: Record<string, unknown> = { [TRAINEE_ID]: state.candidate };
  for (const [i, o] of opponents.entries()) initialParams[`opp-${i}`] = o.params;

  try {
    const replay = await runMatchEngine({
      bots: procs,
      config: { maxTicks: cfg.ticks },
      seed: Math.floor(Math.random() * 0x7F_FF_FF_FF),
      initialParams,
    });
    const place = replay.finalPlacements.find((p) => p.botId === TRAINEE_ID)?.placement ?? procs.length;
    const stats = replay.finalStats.find((s) => s.botId === TRAINEE_ID);
    const lastBots = replay.ticks.at(-1)?.worldSnapshot.bots ?? [];
    const finalHp = lastBots.find((b) => b.id === TRAINEE_ID)?.hp ?? 0;
    const reward = place
      - (stats?.damageDealt ?? 0) * 0.005
      - (stats?.itemsPicked ?? 0) * 0.1
      - Math.max(0, finalHp) * 0.005;
    return { reward, won: place === 1 };
  } finally {
    for (const proc of procs) proc.kill();
  }
}

// ─── helpers ─────────────────────────────────────────────────────────

function gauss(): number {
  const u = Math.max(1e-9, Math.random());
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clone(o: unknown): unknown {
  if (o === null || o === undefined || typeof o !== "object") return o;
  return globalThis.structuredClone(o);
}

function perturb(obj: unknown, s: number, key?: string): unknown {
  if (key !== undefined && EXCLUDE_KEYS.has(key)) return clone(obj);
  if (typeof obj === "number") {
    return Math.random() < cfg.mutationRate ? obj + gauss() * s : obj;
  }
  if (Array.isArray(obj)) return obj.map((v) => perturb(v, s));
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = perturb(v, s, k);
    return out;
  }
  return obj;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
