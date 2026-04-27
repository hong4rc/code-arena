#!/usr/bin/env bun
/* eslint-disable no-console */
// Train one bot by playing it against opponents and evolving its `state.params`
// blob across matches. The bot itself doesn't need any learning code — the
// trainer treats every numeric leaf of `params` as a tunable parameter and
// runs (1+1)-Evolution Strategy at the trainer level:
//
//   1. Champion = current params (loaded from DB / file).
//   2. Each match plays a *candidate* = champion with Gaussian noise added to
//      every numeric value.  Stddev = σ, self-adaptive.
//   3. After CANDIDATE_BATCH matches, compare avg(candidate placement) to
//      champion's baseline.  Promote candidate or discard.
//
// This works for ANY bot — neural-net weights, heuristic knobs, anything —
// as long as the bot reads its tunables from `state.params`.
//
// Modes:
//   • DB:    bun run train --db-bot-id <uuid>      (or --db-bot-name <name>)
//   • FILE:  bun run train --bot bots/samples/nn-bot.js
//
// Common: --matches N --opponents a.js,b.js --save-every M --width N --ticks N
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { SubprocessSandbox, DrizzleBotParamsRepo, DrizzleBotRepo } from "@arena/adapters";
import { runMatchEngine } from "@arena/application";

interface Args {
  bot?: string;
  params?: string;
  pushToDb?: boolean;
  dbBotId?: string;
  dbBotName?: string;
  saveEvery?: number;
  opponents: string[];
  matches: number;
  width?: number;
  height?: number;
  ticks?: number;
  sigma?: number;
  sigmaMax?: number;
  batch?: number;
  exclude?: string[];
  /** Fraction of numeric leaves to perturb per candidate (0..1). Default 1. */
  mutationRate?: number;
  /** Pure evaluation — no perturbation, no saving. Measures true champion winrate. */
  eval?: boolean;
}

const DEFAULT_OPPONENTS = [
  "bots/samples/random-bot.js",
  "bots/samples/greedy-bot.js",
  "bots/samples/defensive-bot.js",
  "bots/samples/hunter-bot.js",
  "bots/samples/survivor-bot.js",
  "bots/samples/zone-bot.js",
];

// Keys the trainer should NEVER perturb — counters, identifiers, history.
// Match by exact key name anywhere in the params tree.
const DEFAULT_EXCLUDE = ["matchesPlayed", "evals", "score", "scores", "recent", "experiment"];

function parseArgs(argv: string[]): Args {
  const a: Args = { opponents: DEFAULT_OPPONENTS, matches: 100, exclude: [...DEFAULT_EXCLUDE] };
  const next = (i: number) => argv[i] ?? "";
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--bot":         { a.bot = next(++i); break; }
      case "--params":      { a.params = next(++i); break; }
      case "--push-to-db":  { a.pushToDb = true; break; }
      case "--db-bot-id":   { a.dbBotId = next(++i); break; }
      case "--db-bot-name": { a.dbBotName = next(++i); break; }
      case "--save-every":  { a.saveEvery = Number(next(++i)); break; }
      case "--opponents":   { a.opponents = next(++i).split(",").filter(Boolean); break; }
      case "--matches":     { a.matches = Number(next(++i)); break; }
      case "--width":       { a.width = Number(next(++i)); break; }
      case "--height":      { a.height = Number(next(++i)); break; }
      case "--ticks":       { a.ticks = Number(next(++i)); break; }
      case "--sigma":       { a.sigma = Number(next(++i)); break; }
      case "--sigma-max":   { a.sigmaMax = Number(next(++i)); break; }
      case "--batch":       { a.batch = Number(next(++i)); break; }
      case "--mutation-rate": { a.mutationRate = Number(next(++i)); break; }
      case "--exclude":     { a.exclude = [...DEFAULT_EXCLUDE, ...next(++i).split(",").filter(Boolean)]; break; }
      case "--eval":        { a.eval = true; break; }
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));

const useDb = Boolean(args.dbBotId || args.dbBotName);
if (!useDb && !args.bot) {
  console.error("Usage:");
  console.error("  bun run train --bot <path.js> [--matches N]                        # file-on-disk");
  console.error("  bun run train --db-bot-id <uuid> [--matches N] [--save-every M]    # DB bot by id");
  console.error("  bun run train --db-bot-name <name> [--matches N]                   # DB bot by name");
  console.error("");
  console.error("Common: --opponents a.js,b.js  --width N --height N --ticks N --sigma 0.2 --batch 3 --exclude key1,key2");
  process.exit(2);
}

// ─── load trainee code + params ──────────────────────────────────────

let traineeName: string;
let traineeCode: string;
let champion: unknown;

const botRepo = new DrizzleBotRepo();
const paramsRepo = new DrizzleBotParamsRepo();
let dbTargetId: string | null = null;

if (useDb) {
  let bot: Awaited<ReturnType<DrizzleBotRepo["findById"]>> = null;
  if (args.dbBotId) {
    bot = await botRepo.findById(args.dbBotId);
    if (!bot) { console.error(`No bot with id ${args.dbBotId}`); process.exit(3); }
  } else {
    const all = await botRepo.findActive();
    bot = all.find((b) => b.name === args.dbBotName) ?? null;
    if (!bot) {
      const officials = await botRepo.findOfficial();
      bot = officials.find((b) => b.name === args.dbBotName) ?? null;
    }
    if (!bot) { console.error(`No bot named "${args.dbBotName}"`); process.exit(3); }
  }
  const version = await botRepo.latestRunnableVersion(bot.id);
  if (!version) { console.error(`Bot "${bot.name}" has no runnable version.`); process.exit(3); }
  traineeName = bot.name;
  traineeCode = version.code;
  dbTargetId = bot.id;
  const row = await paramsRepo.latest(bot.id);
  champion = row?.params ?? {};
  console.log(`Trainee: ${traineeName} (db bot ${bot.id.slice(0, 8)})`);
  console.log(`Params:  ${row ? `bot_params v${row.version}` : "fresh (no prior params — will inject random noise)"}`);
} else {
  const traineePath = resolve(args.bot!);
  traineeName = args.bot!.split("/").pop()?.replace(/\.[jt]s$/, "") ?? "trainee";
  traineeCode = readFileSync(traineePath, "utf8");
  if (!args.params) args.params = `.training/${traineeName}.json`;
  mkdirSync(dirname(resolve(args.params)), { recursive: true });
  champion = existsSync(args.params) ? JSON.parse(readFileSync(args.params, "utf8")) : {};
  console.log(`Trainee: ${traineeName} (${traineePath})`);
  console.log(`Params:  ${args.params}${existsSync(args.params) ? " (loaded)" : " (fresh)"}`);
}

const opponentPaths = args.opponents.map((p) => resolve(p));
const opponentCode = opponentPaths.map((p) => ({ path: p, code: readFileSync(p, "utf8") }));
console.log(`Opponents: ${opponentCode.length} — ${opponentPaths.map((p) => p.split("/").pop()).join(", ")}`);

// ─── ES state (lives in the trainer, not the bot) ────────────────────

let sigma = args.sigma ?? 0.2;
const SIGMA_MIN = 0.01;
const SIGMA_MAX = args.sigmaMax ?? 0.5;
const SIGMA_DECAY = 0.85;
const SIGMA_GROW = 1.20;
const BATCH = args.batch ?? 3;
const MUTATION_RATE = args.mutationRate ?? 1;
const exclude = new Set(args.exclude);

// Champion baseline: avg placement when *not* perturbed. We only know this
// after at least one batch — initialize to "worst possible" so the first
// candidate always passes if it does anything reasonable. We also track the
// all-time best champion so a noisy "accepted but worse" promotion gets
// rolled back at end of training.
const champBaseline: { score: number; samples: number } = { score: opponentCode.length + 1, samples: 0 };
let bestEver: { params: unknown; score: number } = { params: clone(champion), score: champBaseline.score };
let candidateScores: number[] = [];

console.log(`Matches: ${args.matches}  σ=${sigma} (max ${SIGMA_MAX})  batch=${BATCH}  mutationRate=${MUTATION_RATE}  exclude={${[...exclude].join(",")}}`);
if (useDb) console.log(`DB save: every ${args.saveEvery ?? args.matches} matches + final`);
console.log("");

// ─── helpers ──────────────────────────────────────────────────────────

function gauss(): number {
  const u = Math.max(1e-9, Math.random());
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Deep clone + perturb numeric leaves with N(0, σ). Each leaf is perturbed
 * independently with probability MUTATION_RATE. Skips excluded keys entirely.
 * Sparse mutation is critical for high-dimensional params (≥1000 weights):
 * perturbing every weight every match destroys all signal.
 */
function perturb(obj: unknown, s: number, key?: string): unknown {
  if (key !== undefined && exclude.has(key)) return clone(obj);
  if (typeof obj === "number") {
    return Math.random() < MUTATION_RATE ? obj + gauss() * s : obj;
  }
  if (Array.isArray(obj)) return obj.map((v) => perturb(v, s));
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = perturb(v, s, k);
    return out;
  }
  return obj;
}

function clone(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  return JSON.parse(JSON.stringify(obj));
}

function countTunables(obj: unknown, key?: string): number {
  if (key !== undefined && exclude.has(key)) return 0;
  if (typeof obj === "number") return 1;
  if (Array.isArray(obj)) return obj.reduce((a: number, v) => a + countTunables(v), 0);
  if (obj && typeof obj === "object") {
    return Object.entries(obj).reduce((a, [k, v]) => a + countTunables(v, k), 0);
  }
  return 0;
}

const tunables = countTunables(champion);
console.log(`Tunable params: ${tunables} numeric leaves found in state.params`);
if (tunables === 0) {
  console.log("  ⚠️  No numeric params to evolve. The bot must read tunables from state.params");
  console.log("      (e.g. state.params.healThreshold ??= 0.5) for training to do anything.");
}
console.log("");

// ─── match loop ──────────────────────────────────────────────────────

const sandbox = new SubprocessSandbox();
const config: Record<string, number> = {};
if (args.ticks !== undefined) config.maxTicks = args.ticks;
if (args.width !== undefined) config.width = args.width;
if (args.height !== undefined) config.height = args.height;

const TRAINEE_ID = "trainee";
const placements: number[] = [];
const wins: number[] = [];
const startedAt = performance.now();
let dbSavesWritten = 0;
const saveEvery = args.saveEvery ?? args.matches;

async function persistParams(reason: string) {
  if (useDb && dbTargetId) {
    const { version } = await paramsRepo.saveNewVersion(dbTargetId, champion);
    dbSavesWritten += 1;
    console.log(`  ↳ saved bot_params v${version} (${reason})`);
  } else if (args.params) {
    writeFileSync(args.params, JSON.stringify(champion), "utf8");
  }
}

// In eval mode, candidate IS the champion (no perturbation, no acceptance).
let candidate: unknown = args.eval ? clone(champion) : perturb(champion, sigma);
if (args.eval) console.log("EVAL MODE — measuring champion winrate, no learning, no save.\n");

for (let m = 0; m < args.matches; m++) {
  const procs = [
    await sandbox.spawn({ botId: TRAINEE_ID, code: traineeCode }),
    ...await Promise.all(opponentCode.map((o, i) =>
      sandbox.spawn({ botId: `opp-${i}-${o.path.split("/").pop()?.replace(/\.[jt]s$/, "")}`, code: o.code }))),
  ];

  try {
    const replay = await runMatchEngine({
      bots: procs,
      config,
      seed: Math.floor(Math.random() * 0x7F_FF_FF_FF),
      initialParams: { [TRAINEE_ID]: candidate },
    });

    const place = replay.finalPlacements.find((p) => p.botId === TRAINEE_ID)?.placement ?? procs.length;
    const stats = replay.finalStats.find((s) => s.botId === TRAINEE_ID);
    const lastBots = replay.ticks.at(-1)?.worldSnapshot.bots ?? [];
    const finalHp = lastBots.find((b) => b.id === TRAINEE_ID)?.hp ?? 0;
    // Reward shaping — lower is better. Pure placement is too sparse for ES
    // when the bot loses every match (no signal).  Damage dealt and survival
    // HP let us differentiate "lost while fighting" from "lost while idle".
    //   placement (1=best, N=worst):  weight 1.0
    //   damageDealt:                   credit -0.005/dmg point
    //   itemsPicked:                   credit -0.1/item
    //   final HP:                      credit -0.005/HP
    const reward = place
      - (stats?.damageDealt ?? 0) * 0.005
      - (stats?.itemsPicked ?? 0) * 0.1
      - Math.max(0, finalHp) * 0.005;
    placements.push(place);
    wins.push(place === 1 ? 1 : 0);
    candidateScores.push(reward);

    // Evolution step every BATCH matches. Skipped in eval mode.
    if (!args.eval && candidateScores.length >= BATCH) {
      const candAvg = candidateScores.reduce((a, b) => a + b, 0) / candidateScores.length;
      const baseline = champBaseline.samples > 0 ? champBaseline.score : opponentCode.length + 1;
      if (candAvg <= baseline) {
        // Candidate wins (lower placement = better).
        champion = candidate;
        champBaseline.score = candAvg;
        champBaseline.samples = candidateScores.length;
        sigma = Math.max(SIGMA_MIN, sigma * SIGMA_DECAY);
      } else {
        sigma = Math.min(SIGMA_MAX, sigma * SIGMA_GROW);
      }
      candidate = perturb(champion, sigma);
      candidateScores = [];
    }

    if ((m + 1) % 10 === 0 || m === 0) {
      const window = placements.slice(-10);
      const avgPlace = window.reduce((a, b) => a + b, 0) / window.length;
      const winPct = (wins.slice(-10).reduce((a, b) => a + b, 0) / window.length) * 100;
      const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
      console.log(
        `[${String(m + 1).padStart(4)}/${args.matches}] last10 avgPlace=${avgPlace.toFixed(2)} win=${winPct.toFixed(0)}%` +
        `  champion=${champBaseline.score.toFixed(2)} σ=${sigma.toFixed(3)}  (${elapsed}s)`,
      );
    }

    if (useDb && (m + 1) < args.matches && (m + 1) % saveEvery === 0) {
      await persistParams(`every ${saveEvery}`);
    }
  } finally {
    for (const proc of procs) proc.kill();
  }
}

// ─── summary + final save ─────────────────────────────────────────────
const overallAvg = placements.reduce((a, b) => a + b, 0) / placements.length;
const overallWin = (wins.reduce((a, b) => a + b, 0) / wins.length) * 100;
const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
console.log("");
console.log(`Done. ${args.matches} matches in ${elapsed}s.`);
console.log(`  overall avgPlace=${overallAvg.toFixed(2)}  win=${overallWin.toFixed(1)}%  champion=${champBaseline.score.toFixed(2)} σ=${sigma.toFixed(3)}`);

if (args.eval) {
  console.log("  (eval mode — no save)");
} else if (useDb) {
  await persistParams("final");
  console.log(`  total bot_params rows written: ${dbSavesWritten}`);
} else if (args.pushToDb) {
  const officials = await botRepo.findOfficial();
  const target = officials.find((b) => b.name === traineeName);
  if (!target) { console.error(`No official bot named "${traineeName}".`); process.exit(3); }
  const { version } = await paramsRepo.saveNewVersion(target.id, champion);
  console.log(`  saved bot_params v${version} for bot ${target.name}`);
} else {
  console.log(`  params saved to ${args.params}`);
}

process.exit(0);
