#!/usr/bin/env bun
/* eslint-disable no-console */
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
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
    if (a === "--bots") out.bots = next(++i).split(",").filter(Boolean);
    else if (a === "--out") out.out = next(++i);
    else if (a === "--seed") out.seed = Number(next(++i));
    else if (a === "--ticks") out.ticks = Number(next(++i));
    else if (a === "--width") out.width = Number(next(++i));
    else if (a === "--height") out.height = Number(next(++i));
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.bots.length < 2) {
  console.error("Usage: arena-match --bots path1.js,path2.js[,...] [--out replay.json] [--seed N] [--ticks N]");
  process.exit(2);
}

const bots = args.bots.map((p, i) => ({
  id: `bot${i + 1}-${p.split("/").pop()?.replace(/\.[jt]s$/, "") ?? "x"}`,
  scriptPath: resolve(p),
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
  ...(args.seed !== undefined ? { seed: args.seed } : {}),
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
