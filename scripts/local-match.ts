#!/usr/bin/env bun
/* eslint-disable no-console */
// Run a local bot-vs-bot match without touching the DB.
// Usage:
//   bun scripts/local-match.ts --bots bots/samples/greedy-bot.js,bots/samples/hunter-bot.js [--seed N] [--ticks N]
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
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.bots.length < 2) {
  console.error("Usage: bun scripts/local-match.ts --bots path1.js,path2.js[,...] [--out replay.json] [--seed N] [--ticks N] [--width N] [--height N]");
  process.exit(2);
}

const sandbox = new SubprocessSandbox();
const procs = await Promise.all(
  args.bots.map(async (p, i) => {
    const code = readFileSync(resolve(p), "utf8");
    const id = `bot${i + 1}-${p.split("/").pop()?.replace(/\.[jt]s$/, "") ?? "x"}`;
    return sandbox.spawn({ botId: id, code });
  }),
);

const config: Record<string, number> = {};
if (args.ticks !== undefined) config.maxTicks = args.ticks;
if (args.width !== undefined) config.width = args.width;
if (args.height !== undefined) config.height = args.height;

console.log(`Starting match with ${procs.length} bots…`);
const startedAt = performance.now();
const replay = await runMatchEngine({
  bots: procs,
  config,
  seed: args.seed ?? Math.floor(Math.random() * 0xFFFF),
  onTick: (t) => {
    const summary = t.worldSnapshot.bots.filter((b) => b.alive)
      .map((b) => `${b.id}@(${b.x},${b.y})hp${b.hp}`).join(" ");
    console.log(`tick ${t.tick}: ${summary}`);
  },
});

for (const p of procs) p.kill();

console.log(`\nFinished in ${(performance.now() - startedAt).toFixed(0)}ms after ${replay.ticks.length} ticks`);
console.log("Final placements:");
for (const p of replay.finalPlacements) console.log(`  ${p.placement}. ${p.botId}`);

if (args.out) {
  writeFileSync(args.out, JSON.stringify(replay, null, 2));
  console.log(`Replay written to ${args.out}`);
}
