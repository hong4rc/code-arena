#!/usr/bin/env bun
/* eslint-disable no-console */
// Long-running trainer service. Runs as a separate process from the main
// Next.js server (e.g. Render Background Worker, or `bun run trainer`).
//
// What it does, forever:
//   1. Reads the list of training-target bots from the DB
//      (admin toggles via `/admin/training`). Env var TRAINER_BOT_IDS overrides.
//   2. For each target bot: pulls its latest code + params, plays a round of
//      training matches against a random sample of OTHER live bots, applies
//      (1+1)-Evolution Strategy to its weights, saves a new bot_params row.
//   3. Sleeps a few seconds, repeats.
//
// CRITICAL INVARIANT: only TARGET bots get bot_params writes. Opponents are
// loaded read-only and their params are never updated. The trainer never
// touches the `matches`, `match_replays`, `match_participants`, `ratings`,
// or `match_queue` tables — live ranked matches and the trainer are isolated.
//
// Env (all optional except DATABASE_URL):
//   TRAINER_BOT_IDS              comma-separated UUIDs (override DB toggle)
//   TRAINER_OPPONENT_POOL_SIZE   how many other bots to sample per round (default 5)
//   TRAINER_INCLUDE_OFFICIAL     "1" to include sample bots in opponents (default 1)
//   TRAINER_MATCHES_PER_ROUND    matches per bot per round (default 60)
//   TRAINER_SIGMA                initial perturbation σ (default 0.04)
//   TRAINER_SIGMA_MAX            cap on adapted σ (default 0.15)
//   TRAINER_BATCH                matches per candidate evaluation (default 12)
//   TRAINER_MUTATION_RATE        fraction of weights perturbed/match (default 0.08)
//   TRAINER_TICKS                maxTicks per training match (default 300)
//   TRAINER_SLEEP_MS             pause between rounds in ms (default 5000)
//   TRAINER_RELOAD_TARGETS_EVERY rounds between target-list refreshes (default 1)
import { SubprocessSandbox, DrizzleBotParamsRepo, DrizzleBotRepo } from "@arena/adapters";
import { runMatchEngine } from "@arena/application";
import type { BotProcess } from "@arena/application";

const cfg = {
  envBotIds: (process.env.TRAINER_BOT_IDS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean),
  opponentPoolSize: Number(process.env.TRAINER_OPPONENT_POOL_SIZE ?? 5),
  includeOfficial: process.env.TRAINER_INCLUDE_OFFICIAL !== "0",
  matchesPerRound: Number(process.env.TRAINER_MATCHES_PER_ROUND ?? 60),
  sigma: Number(process.env.TRAINER_SIGMA ?? 0.04),
  sigmaMax: Number(process.env.TRAINER_SIGMA_MAX ?? 0.15),
  batch: Number(process.env.TRAINER_BATCH ?? 12),
  mutationRate: Number(process.env.TRAINER_MUTATION_RATE ?? 0.08),
  ticks: Number(process.env.TRAINER_TICKS ?? 300),
  sleepMs: Number(process.env.TRAINER_SLEEP_MS ?? 5000),
  reloadEvery: Number(process.env.TRAINER_RELOAD_TARGETS_EVERY ?? 1),
};

const SIGMA_MIN = 0.01;
const SIGMA_DECAY = 0.85;
const SIGMA_GROW = 1.20;
const EXCLUDE_KEYS = new Set(["matchesPlayed", "evals", "score", "scores", "recent", "experiment"]);
const TRAINEE_ID = "trainee";

const botRepo = new DrizzleBotRepo();
const paramsRepo = new DrizzleBotParamsRepo();
const sandbox = new SubprocessSandbox();

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
}

// ─── helpers ─────────────────────────────────────────────────────────

function gauss(): number {
  const u = Math.max(1e-9, Math.random());
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clone(o: unknown): unknown {
  if (o === null || o === undefined || typeof o !== "object") return o;
  return JSON.parse(JSON.stringify(o));
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

// ─── target / opponent loading ───────────────────────────────────────

async function loadTargets(): Promise<TraineeState[]> {
  const targets = cfg.envBotIds.length > 0
    ? (await Promise.all(cfg.envBotIds.map((id) => botRepo.findById(id)))).filter((b): b is NonNullable<typeof b> => b !== null)
    : await botRepo.findTrainingTargets();

  const states: TraineeState[] = [];
  for (const bot of targets) {
    const ver = await botRepo.latestRunnableVersion(bot.id);
    if (!ver) { console.warn(`[trainer] skip ${bot.name} — no runnable version`); continue; }
    const params = await paramsRepo.latest(bot.id);
    const champion = params?.params ?? {};
    states.push({
      botId: bot.id,
      name: bot.name,
      code: ver.code,
      champion,
      candidate: perturb(champion, cfg.sigma),
      candidateScores: [],
      champBaseline: 99,    // worst-case; first batch always wins on first round
      sigma: cfg.sigma,
      totalRounds: 0,
      totalMatches: 0,
      totalWins: 0,
    });
  }
  return states;
}

async function loadOpponents(excludeIds: Set<string>): Promise<OpponentBot[]> {
  // Pull every active bot, drop the trainees, drop non-runnable. If the pool
  // is too small we fall back to using sample bots' code from disk.
  const all = await botRepo.findActive();
  const candidates = all.filter((b) => !excludeIds.has(b.id) && (cfg.includeOfficial || !b.isOfficial));
  const picked = shuffle(candidates).slice(0, cfg.opponentPoolSize);
  const out: OpponentBot[] = [];
  for (const bot of picked) {
    const ver = await botRepo.latestRunnableVersion(bot.id);
    if (!ver) continue;
    const params = await paramsRepo.latest(bot.id);
    out.push({
      botId: bot.id,
      name: bot.name,
      code: ver.code,
      params: params?.params ?? {},
    });
  }
  return out;
}

// ─── one match ───────────────────────────────────────────────────────

async function runOneMatch(state: TraineeState, opponents: OpponentBot[]): Promise<{ reward: number; won: boolean }> {
  const procs: BotProcess[] = [];
  procs.push(await sandbox.spawn({ botId: TRAINEE_ID, code: state.code }));
  for (let i = 0; i < opponents.length; i++) {
    const o = opponents[i]!;
    procs.push(await sandbox.spawn({ botId: `opp-${i}`, code: o.code }));
  }

  const initialParams: Record<string, unknown> = { [TRAINEE_ID]: state.candidate };
  for (let i = 0; i < opponents.length; i++) {
    initialParams[`opp-${i}`] = opponents[i]!.params;
  }

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

// ─── one round per trainee ───────────────────────────────────────────

async function trainOneRound(state: TraineeState, opponents: OpponentBot[]): Promise<{ wins: number; total: number }> {
  let wins = 0;
  let total = 0;
  for (let m = 0; m < cfg.matchesPerRound; m++) {
    const { reward, won } = await runOneMatch(state, opponents);
    state.candidateScores.push(reward);
    state.totalMatches += 1;
    total += 1;
    if (won) { wins += 1; state.totalWins += 1; }

    if (state.candidateScores.length >= cfg.batch) {
      const avg = state.candidateScores.reduce((a, b) => a + b, 0) / state.candidateScores.length;
      if (avg <= state.champBaseline) {
        state.champion = state.candidate;
        state.champBaseline = avg;
        state.sigma = Math.max(SIGMA_MIN, state.sigma * SIGMA_DECAY);
      } else {
        state.sigma = Math.min(cfg.sigmaMax, state.sigma * SIGMA_GROW);
      }
      state.candidate = perturb(state.champion, state.sigma);
      state.candidateScores = [];
    }
  }

  // Persist ONLY the trainee's params. Opponents are never written.
  const { version } = await paramsRepo.saveNewVersion(state.botId, state.champion);
  state.totalRounds += 1;
  console.log(
    `[trainer] ${state.name.padEnd(16)} round=${state.totalRounds} ` +
    `match=${state.totalMatches} win=${wins}/${total} (${((wins / total) * 100).toFixed(0)}%) ` +
    `champion=${state.champBaseline.toFixed(2)} σ=${state.sigma.toFixed(3)} → bot_params v${version}`,
  );
  return { wins, total };
}

// ─── main loop ───────────────────────────────────────────────────────

console.log(`[trainer] starting`);
console.log(`  source: ${cfg.envBotIds.length > 0 ? `env TRAINER_BOT_IDS (${cfg.envBotIds.length} bots)` : "DB is_training_target flag"}`);
console.log(`  opponents/round: ${cfg.opponentPoolSize}  includeOfficial=${cfg.includeOfficial}`);
console.log(`  matches/round: ${cfg.matchesPerRound}  ticks: ${cfg.ticks}`);
console.log(`  σ=${cfg.sigma} (max ${cfg.sigmaMax})  batch=${cfg.batch}  mutation=${cfg.mutationRate}`);
console.log("");

let stopping = false;
process.on("SIGINT",  () => { console.log("\n[trainer] SIGINT — finishing current round…"); stopping = true; });
process.on("SIGTERM", () => { console.log("\n[trainer] SIGTERM — finishing current round…"); stopping = true; });

let trainees: TraineeState[] = [];
let roundsSinceReload = Number.POSITIVE_INFINITY;

while (!stopping) {
  // (Re)load target list on the first iteration, and every N rounds, so the
  // trainer picks up admin toggles without restart.
  if (roundsSinceReload >= cfg.reloadEvery) {
    const fresh = await loadTargets();
    if (fresh.length === 0) {
      console.log(`[trainer] no training targets — sleeping ${cfg.sleepMs}ms`);
      await new Promise((r) => setTimeout(r, cfg.sleepMs));
      continue;
    }
    // Carry over evolution state for bots that are still being trained, so an
    // admin re-toggle doesn't reset σ / champion baseline.
    const byId = new Map(trainees.map((t) => [t.botId, t]));
    trainees = fresh.map((t) => {
      const prev = byId.get(t.botId);
      return prev ? { ...t, sigma: prev.sigma, champBaseline: prev.champBaseline, totalRounds: prev.totalRounds, totalMatches: prev.totalMatches, totalWins: prev.totalWins } : t;
    });
    console.log(`[trainer] training: ${trainees.map((t) => t.name).join(", ")}`);
    roundsSinceReload = 0;
  }

  const traineeIds = new Set(trainees.map((t) => t.botId));
  for (const state of trainees) {
    if (stopping) break;
    try {
      // Re-pick opponents each round so the bot sees varied matchups.
      const opponents = await loadOpponents(traineeIds);
      if (opponents.length < 1) {
        console.warn(`[trainer] not enough opponents — sleeping`);
        await new Promise((r) => setTimeout(r, cfg.sleepMs));
        continue;
      }
      // Reload trainee code each round (admin may have re-saved).
      const ver = await botRepo.latestRunnableVersion(state.botId);
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
  if (!stopping) await new Promise((r) => setTimeout(r, cfg.sleepMs));
}

console.log("[trainer] stopped");
process.exit(0);
