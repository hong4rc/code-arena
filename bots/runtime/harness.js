// Code Arena bot runtime harness.
// Run as:  node harness.js <path-to-bot.js>
//
// Reads one observation per line from stdin, calls the user's exported
// `decide(observation, state)`, writes one action per line to stdout.
//
// Bot authors do NOT touch this file. Their bot is a single file that
// default-exports a `decide` function. Helpers (adjacent, nearestBot,
// nearestItem, dirTo, …) are exposed as globals so user code stays simple.
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// ────────────────────── helpers exposed as globals ──────────────────────

const DELTA = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };

/** All four cardinal directions. */
globalThis.DIRS = ["UP", "DOWN", "LEFT", "RIGHT"];

/** The cell directly adjacent to you in the given direction. May be undefined off-grid. */
globalThis.adjacent = function adjacent(obs, dir) {
  const r = (obs.view.length - 1) >> 1;
  const [dx, dy] = DELTA[dir];
  return obs.view[r + dy]?.[r + dx];
};

/** The cell you are standing on (useful for PICKUP). */
globalThis.here = function here(obs) {
  const r = (obs.view.length - 1) >> 1;
  return obs.view[r][r];
};

/**
 * Find the nearest visible cell matching a predicate.
 * Returns { dx, dy, dist, ...cellFields } or null.
 *
 *   nearest(obs, c => c.kind === "bot")
 */
globalThis.nearest = function nearest(obs, predicate) {
  const r = (obs.view.length - 1) >> 1;
  let best = null;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0) continue;
      const cell = obs.view[dy + r][dx + r];
      if (!cell || !predicate(cell)) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (!best || d < best.dist) best = { dx, dy, dist: d, ...cell };
    }
  }
  return best;
};

/** Nearest visible enemy bot, or null. Includes hp. */
globalThis.nearestBot = function nearestBot(obs) {
  return globalThis.nearest(obs, (c) => c.kind === "bot");
};

/** Nearest visible item (optionally filtered by kind), or null. */
globalThis.nearestItem = function nearestItem(obs, kind) {
  return globalThis.nearest(obs, (c) => c.kind === "item" && (!kind || c.item === kind));
};

/** All visible bots as an array of { dx, dy, dist, hp, botId }. */
globalThis.visibleBots = function visibleBots(obs) {
  return collect(obs, (c) => c.kind === "bot");
};

/** All visible items as an array of { dx, dy, dist, item }. */
globalThis.visibleItems = function visibleItems(obs, kind) {
  return collect(obs, (c) => c.kind === "item" && (!kind || c.item === kind));
};

function collect(obs, predicate) {
  const r = (obs.view.length - 1) >> 1;
  const out = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0) continue;
      const cell = obs.view[dy + r][dx + r];
      if (cell && predicate(cell)) {
        out.push({ dx, dy, dist: Math.abs(dx) + Math.abs(dy), ...cell });
      }
    }
  }
  return out;
}

/** One-step direction toward a target offset (dx, dy). */
globalThis.dirTo = function dirTo(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "RIGHT" : "LEFT";
  return dy >= 0 ? "DOWN" : "UP";
};

/** Direction that runs AWAY from a target offset. */
globalThis.fleeFrom = function fleeFrom(dx, dy) {
  return globalThis.dirTo(-dx, -dy);
};

/** Convenience: pick a random element from an array. */
globalThis.pickRandom = function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
};

// ──────────────────────────── run loop ────────────────────────────────

const botPath = process.argv[2];
if (!botPath) {
  process.stderr.write("usage: harness.js <bot.js>\n");
  process.exit(1);
}

const mod = await import(pathToFileURL(resolve(botPath)).href);
const decide = mod.default ?? mod.decide;
if (typeof decide !== "function") {
  process.stderr.write("Bot must default-export a `decide(observation, state)` function.\n");
  process.exit(1);
}

const state = {};
const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
  let action;
  try {
    const obs = JSON.parse(line);
    action = decide(obs, state);
    if (!action || typeof action !== "object" || typeof action.type !== "string") {
      action = { type: "WAIT" };
    }
  } catch {
    action = { type: "WAIT" };
  }
  process.stdout.write(JSON.stringify(action) + "\n");
});

rl.on("close", () => process.exit(0));
