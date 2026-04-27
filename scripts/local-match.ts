#!/usr/bin/env bun
/* eslint-disable no-console */
// Run a local bot-vs-bot match without touching the DB.
// Usage:
//   bun scripts/local-match.ts --bots bots/samples/survivor-bot.js,bots/samples/hunter-bot.js,bots/samples/defensive-bot.js,bots/samples/greedy-bot.js
//
// Add --quiet to skip the per-tick log; --out file.json to save the replay.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { runMatchEngine } from "@arena/application";
import { SubprocessSandbox } from "@arena/adapters";

interface Args {
  bots: string[];
  out?: string;
  seed?: number;
  ticks?: number;
  width?: number;
  height?: number;
  quiet?: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { bots: [] };
  const next = (i: number) => argv[i] ?? "";
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--bots": { out.bots = next(++i).split(",").filter(Boolean); break; }
      case "--out": { out.out = next(++i); break; }
      case "--seed": { out.seed = Number(next(++i)); break; }
      case "--ticks": { out.ticks = Number(next(++i)); break; }
      case "--width": { out.width = Number(next(++i)); break; }
      case "--height": { out.height = Number(next(++i)); break; }
      case "--quiet": { out.quiet = true; break; }
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.bots.length < 2) {
  console.error("Usage: bun scripts/local-match.ts --bots path1.js,path2.js[,...] [--out replay.json] [--seed N] [--ticks N] [--width N] [--height N] [--quiet]");
  process.exit(2);
}

const sandbox = new SubprocessSandbox();
const botIds: string[] = [];
const procs = await Promise.all(
  args.bots.map(async (p, i) => {
    const code = readFileSync(resolve(p), "utf8");
    const id = `${i + 1}-${p.split("/").pop()?.replace(/\.[jt]s$/, "") ?? "x"}`;
    botIds.push(id);
    return sandbox.spawn({ botId: id, code });
  }),
);

const config: Record<string, number> = {};
if (args.ticks !== undefined) config.maxTicks = args.ticks;
if (args.width !== undefined) config.width = args.width;
if (args.height !== undefined) config.height = args.height;

console.log(`▶ ${procs.length} bots: ${botIds.join(", ")}`);
const startedAt = performance.now();

// Stats accumulators for the post-match summary.
const stats = new Map<string, { shots: number; hits: number; melee: number; pickups: number; deaths?: number }>();
for (const id of botIds) stats.set(id, { shots: 0, hits: 0, melee: 0, pickups: 0 });

let prevHp = new Map<string, number>();
let prevAlive = new Set<string>(botIds);
let firstShrinkTick: number | null = null;
let suddenDeathTick: number | null = null;

const replay = await runMatchEngine({
  bots: procs,
  config,
  seed: args.seed ?? Math.floor(Math.random() * 0xFFFF),
  onTick: (t) => {
    // Track stats from this tick's actions
    for (const a of t.actions ?? []) {
      const s = stats.get(a.botId);
      if (!s) continue;
      if (a.applied.type === "SHOOT") s.shots += 1;
      if (a.applied.type === "ATTACK") s.melee += 1;
      if (a.applied.type === "PICKUP") s.pickups += 1;
    }
    // HP delta to count bullet hits roughly: any bot whose HP dropped this tick
    for (const b of t.worldSnapshot.bots) {
      const before = prevHp.get(b.id) ?? b.hp;
      if (b.hp < before) {
        // Don't know which shooter hit them — credit goes to whoever shot toward them this tick.
        const shooter = (t.actions ?? []).find((a) => a.applied.type === "SHOOT" && a.botId !== b.id);
        if (shooter) {
          const s = stats.get(shooter.botId);
          if (s) s.hits += 1;
        }
      }
      prevHp.set(b.id, b.hp);
    }
    // Note KO ticks
    const aliveNow = new Set(t.worldSnapshot.bots.filter((b) => b.alive).map((b) => b.id));
    for (const id of prevAlive) {
      if (!aliveNow.has(id)) console.log(`  💀 tick ${t.tick}: ${id} eliminated`);
    }
    prevAlive = aliveNow;
    // Note zone shrinks
    const z = t.worldSnapshot.zone;
    if (z) {
      const w = z.xMax - z.xMin + 1;
      const h = z.yMax - z.yMin + 1;
      if (firstShrinkTick === null && (w < (config.width ?? 30) || h < (config.height ?? 30))) {
        firstShrinkTick = t.tick;
        console.log(`  🌀 tick ${t.tick}: zone closed to ${w}×${h}`);
      }
      if (suddenDeathTick === null && w <= 1 && h <= 1) {
        suddenDeathTick = t.tick;
        console.log(`  ☠ tick ${t.tick}: SUDDEN DEATH — every cell hurts`);
      }
    }
    if (!args.quiet && t.tick % 20 === 0) {
      const alive = t.worldSnapshot.bots.filter((b) => b.alive)
        .map((b) => `${b.id}:${b.hp}HP`).join("  ");
      const bullets = (t.worldSnapshot.bullets ?? []).length;
      console.log(`tick ${String(t.tick).padStart(3)}  alive: ${alive}  bullets: ${bullets}`);
    }
  },
});

for (const p of procs) p.kill();

const ms = (performance.now() - startedAt).toFixed(0);
console.log(`\n✓ Match finished in ${ms}ms over ${replay.ticks.length} ticks`);
console.log("\nFinal placements:");
for (const p of replay.finalPlacements) {
  const final = replay.ticks.at(-1)?.worldSnapshot.bots.find((b) => b.id === p.botId);
  const tag = p.placement === 1 ? "🏆" : "  ";
  console.log(`  ${tag} #${p.placement}  ${p.botId.padEnd(20)}  ${final?.alive ? `${final.hp} HP alive` : "KO"}`);
}

console.log("\nStats per bot:");
for (const [id, s] of stats) {
  const accuracy = s.shots > 0 ? `${Math.round((s.hits / s.shots) * 100)}%` : "—";
  console.log(`  ${id.padEnd(20)}  shots: ${s.shots}  hits: ${s.hits} (${accuracy})  melee: ${s.melee}  pickups: ${s.pickups}`);
}

if (args.out) {
  writeFileSync(args.out, JSON.stringify(replay, null, 2));
  console.log(`\nReplay written to ${args.out}`);
}
