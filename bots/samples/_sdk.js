// Code Arena SDK runtime harness.
// Reads one observation per line from stdin, calls user's decide(),
// writes one action per line to stdout.
//
// User code exports `decide(observation, state)`. State is a per-bot object
// that persists across ticks (in the same match). Modify it freely.
//
// This file is shipped with the platform — bot authors do NOT touch it.

import { createInterface } from "node:readline";

export function runBot(decide) {
  const state = {};
  const rl = createInterface({ input: process.stdin });

  rl.on("line", (line) => {
    let action;
    try {
      const observation = JSON.parse(line);
      action = decide(observation, state);
      if (!action || typeof action !== "object" || typeof action.type !== "string") {
        action = { type: "WAIT" };
      }
    } catch {
      action = { type: "WAIT" };
    }
    process.stdout.write(JSON.stringify(action) + "\n");
  });

  rl.on("close", () => process.exit(0));
}

// Helpers exposed to bots.

export const DIRS = ["UP", "DOWN", "LEFT", "RIGHT"];

const DELTA = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };

/** Find nearest visible cell matching predicate. Returns {dx, dy, cell} or null. */
export function findNearest(observation, predicate) {
  const { view } = observation;
  const r = Math.floor(view.length / 2);
  let best = null;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0) continue;
      const cell = view[dy + r][dx + r];
      if (!predicate(cell)) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (!best || d < best.dist) best = { dx, dy, cell, dist: d };
    }
  }
  return best;
}

/** Choose one of UP/DOWN/LEFT/RIGHT moving toward (dx, dy) from origin. */
export function moveToward(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "RIGHT" : "LEFT";
  return dy > 0 ? "DOWN" : "UP";
}

/** Get the cell adjacent to self in given direction. */
export function adjacent(observation, dir) {
  const r = Math.floor(observation.view.length / 2);
  const [dx, dy] = DELTA[dir];
  return observation.view[r + dy]?.[r + dx];
}

export function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
