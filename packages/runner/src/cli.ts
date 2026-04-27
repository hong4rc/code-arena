#!/usr/bin/env bun
/* eslint-disable no-console */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { runMatch } from "./match.ts";

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
    const a = argv[i];
    switch (a) {
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
  console.error("Usage: arena-match --bots path1.js,path2.js[,...] [--out replay.json] [--seed N] [--ticks N]");
  process.exit(2);
}

const harnessPath = resolve("bots/runtime/harness.js");
const bots = args.bots.map((p, i) => ({
  id: `bot${i + 1}-${p.split("/").pop()?.replace(/\.[jt]s$/, "") ?? "x"}`,
  scriptPath: resolve(p),
  harnessPath,
}));

const config: Record<string, number> = {};
if (args.ticks !== undefined) config.maxTicks = args.ticks;
if (args.width !== undefined) config.width = args.width;
if (args.height !== undefined) config.height = args.height;

console.log(`Starting match with ${bots.length} bots…`);
const startedAt = performance.now();

const replay = await runMatch({
  bots,
  config,
  ...(args.seed === undefined ? {} : { seed: args.seed }),
  onTick: (t) => {
    const summary = t.worldSnapshot.bots
      .filter((b) => b.alive)
      .map((b) => `${b.id}@(${b.x},${b.y})hp${b.hp}`)
      .join(" ");
    console.log(`tick ${t.tick}: ${summary}`);
  },
});

const elapsed = performance.now() - startedAt;
console.log(`\nFinished in ${elapsed.toFixed(0)}ms after ${replay.ticks.length} ticks`);
console.log("Final placements:");
for (const p of replay.finalPlacements) console.log(`  ${p.placement}. ${p.botId}`);

if (args.out) {
  writeFileSync(args.out, JSON.stringify(replay, null, 2));
  console.log(`Replay written to ${args.out}`);
}
