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

/**
 * Bots immediately next to you, keyed by direction. Always returns an array
 * with one entry per adjacent enemy: [{ dir, dx, dy, hp, botId }, ...].
 */
globalThis.adjacentBots = function adjacentBots(obs) {
  const out = [];
  for (const dir of globalThis.DIRS) {
    const c = globalThis.adjacent(obs, dir);
    if (c?.kind === "bot") out.push({ dir, ...c });
  }
  return out;
};

/** Items in any of the 4 adjacent cells. */
globalThis.adjacentItems = function adjacentItems(obs) {
  const out = [];
  for (const dir of globalThis.DIRS) {
    const c = globalThis.adjacent(obs, dir);
    if (c?.kind === "item") out.push({ dir, ...c });
  }
  return out;
};

/** One-step direction toward a target offset (dx, dy). */
globalThis.dirTo = function dirTo(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "RIGHT" : "LEFT";
  return dy >= 0 ? "DOWN" : "UP";
};

/** Direction that runs AWAY from a target offset. */
globalThis.fleeFrom = function fleeFrom(dx, dy) {
  return globalThis.dirTo(-dx, -dy);
};

/** Opposite cardinal: opposite("UP") === "DOWN". */
globalThis.opposite = function opposite(dir) {
  return { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" }[dir];
};

/** Manhattan distance between two offsets, or one (dx,dy) pair. */
globalThis.dist = function dist(dx, dy) {
  // Accept either dist({dx,dy}) or dist(dx, dy).
  if (typeof dx === "object" && dx !== null) return Math.abs(dx.dx) + Math.abs(dx.dy);
  return Math.abs(dx) + Math.abs(dy);
};

// ─── action / state predicates ──────────────────────────────────────────

/** Can you legally MOVE in this direction? (in-bounds, empty cell) */
globalThis.canMove = function canMove(obs, dir) {
  const c = globalThis.adjacent(obs, dir);
  return c?.kind === "empty" || c?.kind === "item";
};

/** Your current attack range — 2 if you hold a WEAPON, otherwise 1. */
globalThis.attackRange = function attackRange(obs) {
  return obs.self.inventory.includes("WEAPON") ? 2 : 1;
};

/**
 * Is there an enemy in attack range in this direction? Handles WEAPON range.
 * Returns the target cell { kind:"bot", hp, botId } or null.
 */
globalThis.canAttack = function canAttack(obs, dir) {
  const r = (obs.view.length - 1) >> 1;
  const range = globalThis.attackRange(obs);
  const delta = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] }[dir];
  for (let step = 1; step <= range; step++) {
    const x = r + delta[0] * step;
    const y = r + delta[1] * step;
    const cell = obs.view[y]?.[x];
    if (!cell || cell.kind === "wall") return null;
    if (cell.kind === "bot") return cell;
  }
  return null;
};

/** Are you standing on an item right now? */
globalThis.canPickup = function canPickup(obs) {
  return globalThis.here(obs)?.kind === "item";
};

/** Do you carry this item? */
globalThis.hasItem = function hasItem(obs, kind) {
  return obs.self.inventory.includes(kind);
};

/** HP fraction (current/maxHp). maxHp defaults to 100. */
globalThis.hpFraction = function hpFraction(obs, maxHp = 100) {
  return obs.self.hp / maxHp;
};

/** Quick "should I heal?" check. Default threshold = 50%. */
globalThis.lowHp = function lowHp(obs, ratio = 0.5) {
  return globalThis.hpFraction(obs) < ratio;
};

/** Direction with the fewest visible enemies (best escape route). */
globalThis.safestDir = function safestDir(obs) {
  const enemies = globalThis.visibleBots(obs);
  if (enemies.length === 0) return globalThis.pickRandom(globalThis.DIRS);
  const score = { UP: 0, DOWN: 0, LEFT: 0, RIGHT: 0 };
  for (const e of enemies) {
    if (e.dy < 0) score.UP += 1;
    if (e.dy > 0) score.DOWN += 1;
    if (e.dx < 0) score.LEFT += 1;
    if (e.dx > 0) score.RIGHT += 1;
  }
  // pick the direction with the LOWEST enemy count, that we can also move into
  const candidates = globalThis.DIRS
    .filter((d) => globalThis.canMove(obs, d))
    .sort((a, b) => score[a] - score[b]);
  return candidates[0] ?? globalThis.pickRandom(globalThis.DIRS);
};

/** Convenience: pick a random element from an array. */
globalThis.pickRandom = function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
};

/**
 * Print debug output. Only the bot owner sees this (it's stderr, captured
 * per-bot by the runner). Won't affect protocol.
 */
globalThis.log = function log(...args) {
  const text = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
    .join(" ");
  process.stderr.write(text + "\n");
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
