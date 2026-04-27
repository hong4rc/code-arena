// Code Arena bot runtime harness.
// Run as:  node harness.js <path-to-bot.js>
//
// Reads one observation per line from stdin, calls the user's exported
// `decide(observation, state)`, writes one action per line to stdout.
//
// Bot authors do NOT touch this file. Their bot is a single file that
// default-exports a `decide` function. Helpers (adjacent, nearestBot,
// nearestItem, dirTo, …) are exposed as globals so user code stays simple.
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

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

/**
 * Direction that closes the SMALLER axis first — useful if you want to align
 * with a target on a row or column (so you can SHOOT them next tick).
 *   dirAlign(3, 1)  → "DOWN"   (close the y=1 first)
 *   dirAlign(1, 3)  → "RIGHT"  (close the x=1 first)
 */
globalThis.dirAlign = function dirAlign(dx, dy) {
  if (Math.abs(dy) <= Math.abs(dx)) {
    if (dy !== 0) return dy > 0 ? "DOWN" : "UP";
    return dx > 0 ? "RIGHT" : "LEFT";
  }
  if (dx !== 0) return dx > 0 ? "RIGHT" : "LEFT";
  return dy > 0 ? "DOWN" : "UP";
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

/** Are you standing on an item right now? Scans the bot's full footprint. */
globalThis.canPickup = function canPickup(obs) {
  const r = (obs.view.length - 1) >> 1;
  const size = obs.self.size ?? 1;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      if (obs.view[r + dy]?.[r + dx]?.kind === "item") return true;
    }
  }
  return false;
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

/**
 * Will an attack in this direction kill the target outright?
 * Returns the target cell if yes, otherwise null.
 * (Approximate: assumes WEAPON adds 5 attack and ignores SHIELD on the target,
 * since you can't see their inventory. Good enough for finishing-blow logic.)
 */
globalThis.canKill = function canKill(obs, dir) {
  const target = globalThis.canAttack(obs, dir);
  if (!target) return null;
  const damage = obs.self.attack + (globalThis.hasItem(obs, "WEAPON") ? 5 : 0);
  return (target.hp ?? 100) <= damage ? target : null;
};

/**
 * The single best ATTACK direction right now.
 * Prefers a one-shot kill; otherwise picks the lowest-HP target in range; else null.
 */
globalThis.bestAttackDir = function bestAttackDir(obs) {
  let kill = null;
  let weakest = null;
  let weakestHp = Infinity;
  for (const dir of globalThis.DIRS) {
    const k = globalThis.canKill(obs, dir);
    if (k) { kill = dir; break; }
    const t = globalThis.canAttack(obs, dir);
    if (t && (t.hp ?? 100) < weakestHp) {
      weakestHp = t.hp ?? 100;
      weakest = dir;
    }
  }
  return kill ?? weakest;
};

/**
 * Try to MOVE in `dir`. If that cell is blocked by a wall or bot, fall back
 * to a perpendicular direction. If all options are blocked, returns null.
 *
 * Returns a direction string, NOT an action object — the caller wraps it:
 *   const d = smartMove(obs, dirTo(target.dx, target.dy));
 *   return d ? { type: "MOVE", dir: d } : { type: "WAIT" };
 */
globalThis.smartMove = function smartMove(obs, dir) {
  if (globalThis.canMove(obs, dir)) return dir;
  const perp = dir === "UP" || dir === "DOWN" ? ["LEFT", "RIGHT"] : ["UP", "DOWN"];
  for (const d of perp) if (globalThis.canMove(obs, d)) return d;
  return null;
};

/**
 * Cells along a straight line in one direction, up to `range` (default = vision radius).
 * Stops at the first wall. Useful for line-of-sight reasoning.
 *   scanLine(obs, "RIGHT")  →  [cell+1, cell+2]   (5x5 view → range 2)
 */
globalThis.scanLine = function scanLine(obs, dir, range) {
  const r = (obs.view.length - 1) >> 1;
  const max = range ?? r;
  const delta = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] }[dir];
  const out = [];
  for (let step = 1; step <= max; step++) {
    const cell = obs.view[r + delta[1] * step]?.[r + delta[0] * step];
    if (!cell || cell.kind === "wall") break;
    out.push({ step, ...cell });
  }
  return out;
};

/** Rotate a direction by `n` quarter-turns clockwise (negative = counter-clockwise). */
globalThis.turn = function turn(dir, n = 1) {
  const order = ["UP", "RIGHT", "DOWN", "LEFT"];
  const i = order.indexOf(dir);
  if (i === -1) return dir;
  return order[((i + n) % 4 + 4) % 4];
};

// ─── zone helpers ───────────────────────────────────────────────────────

/** True if you're inside the current safe zone (no per-tick HP damage). */
globalThis.inZone = function inZone(obs) {
  const { x, y } = obs.self;
  const z = obs.zone;
  return x >= z.xMin && x <= z.xMax && y >= z.yMin && y <= z.yMax;
};

/**
 * Direction toward the center of the safe zone — useful when you're outside
 * it and taking damage and need to run home.
 */
globalThis.dirToZone = function dirToZone(obs) {
  const cx = (obs.zone.xMin + obs.zone.xMax) / 2;
  const cy = (obs.zone.yMin + obs.zone.yMax) / 2;
  return globalThis.dirTo(cx - obs.self.x, cy - obs.self.y);
};

/** Direction toward the center of the announced *next* safe zone, or null if none. */
globalThis.dirToNextZone = function dirToNextZone(obs) {
  const nz = obs.zone.nextZone;
  if (!nz) return null;
  const cx = (nz.xMin + nz.xMax) / 2;
  const cy = (nz.yMin + nz.yMax) / 2;
  return globalThis.dirTo(cx - obs.self.x, cy - obs.self.y);
};

/** Are you already inside the announced next zone (= safe through the next shrink)? */
globalThis.inNextZone = function inNextZone(obs) {
  const nz = obs.zone.nextZone;
  if (!nz) return true;
  const { x, y } = obs.self;
  return x >= nz.xMin && x <= nz.xMax && y >= nz.yMin && y <= nz.yMax;
};

/** Ticks until the next zone shrink (null = no shrink scheduled). */
globalThis.ticksUntilShrink = function ticksUntilShrink(obs) {
  return obs.zone.ticksUntilShrink;
};

// ─── projectile helpers ─────────────────────────────────────────────────

/** All visible bullets as an array of { dx, dy, dist, vx, vy, ownerId }. */
globalThis.visibleBullets = function visibleBullets(obs) {
  return collect(obs, (c) => c.kind === "bullet");
};

/**
 * Bullets that look like they're heading toward you. Approximate — checks
 * whether the bullet's velocity vector is pointing roughly in your direction
 * (dot product of "from-bullet-to-you" with bullet velocity is positive).
 */
globalThis.incomingBullets = function incomingBullets(obs) {
  return globalThis.visibleBullets(obs).filter((b) => {
    // From bullet to me: (-b.dx, -b.dy). Bullet velocity: (b.vx, b.vy).
    // Aimed at me ⇨ those vectors point the same way ⇨ dot > 0.
    return (-b.dx) * b.vx + (-b.dy) * b.vy > 0;
  });
};

// ─── memory + prediction (uses persistent `state`) ──────────────────────

/**
 * Record positions of every visible enemy this tick into `state.enemyPos[id]`
 * (a ring buffer of the last 3 ticks). Returns an estimated velocity (cells/tick)
 * for each enemy as `{ id: { vx, vy } }` — averaged over the most recent deltas.
 *
 * Call once at the top of `decide(obs, state)` before using `leadShot`.
 */
globalThis.trackEnemies = function trackEnemies(obs, state) {
  state.enemyHistory ??= {};
  const seenIds = new Set();
  // Absolute positions of visible enemies this tick.
  for (const e of globalThis.visibleBots(obs)) {
    seenIds.add(e.botId);
    const ax = obs.self.x + e.dx;
    const ay = obs.self.y + e.dy;
    const buf = state.enemyHistory[e.botId] ??= [];
    buf.push({ tick: obs.tick, x: ax, y: ay });
    while (buf.length > 4) buf.shift();
  }
  // Velocity estimate from last two recorded positions (cells per tick).
  const velocity = {};
  for (const [id, buf] of Object.entries(state.enemyHistory)) {
    if (buf.length < 2) { velocity[id] = { vx: 0, vy: 0 }; continue; }
    const a = buf.at(-2);
    const b = buf.at(-1);
    const dt = Math.max(1, b.tick - a.tick);
    velocity[id] = { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  }
  // Drop stale entries (haven't seen them in 12 ticks).
  for (const id of Object.keys(state.enemyHistory)) {
    const last = state.enemyHistory[id].at(-1);
    if (!seenIds.has(id) && obs.tick - last.tick > 12) delete state.enemyHistory[id];
  }
  return velocity;
};

/**
 * Compute a SHOOT target that LEADS a moving enemy — aims at where the enemy
 * will be by the time the bullet arrives, not where it is now.
 *
 *   const vel = trackEnemies(obs, state);
 *   const tgt = leadShot(obs, enemy, vel[enemy.botId], { bulletSpeed: 5 });
 *   if (tgt) return { type: "SHOOT", target: tgt };
 *
 * Returns { dx, dy } offset from bot.pos, suitable for SHOOT.target. Falls back
 * to (enemy.dx, enemy.dy) when no velocity history exists.
 */
globalThis.leadShot = function leadShot(obs, enemy, vel, opts) {
  const speed = opts?.bulletSpeed ?? 5;
  const v = vel ?? { vx: 0, vy: 0 };
  // Enemy position now (absolute).
  const ex = obs.self.x + enemy.dx;
  const ey = obs.self.y + enemy.dy;
  // Spawn point in absolute coords (bot center).
  const half = Math.floor((obs.self.size ?? 1) / 2);
  const sx = obs.self.x + half;
  const sy = obs.self.y + half;
  // Iterative solve: t = distance(now) / bullet_speed; refine 2× with predicted pos.
  let tx = ex, ty = ey;
  for (let i = 0; i < 3; i++) {
    const dist = Math.hypot(tx - sx, ty - sy);
    const t = dist / speed;
    tx = ex + v.vx * t;
    ty = ey + v.vy * t;
  }
  return { dx: Math.round(tx - obs.self.x), dy: Math.round(ty - obs.self.y) };
};

// ─── roster helpers ─────────────────────────────────────────────────────

/** Number of bots still alive (incl. you). 1 = you've won. */
globalThis.aliveCount = function aliveCount(obs) {
  return (obs.roster ?? []).filter((b) => b.alive).length;
};

/** True if every other bot is dead — late-game / 1v1 trigger. */
globalThis.isEndgame = function isEndgame(obs) {
  return globalThis.aliveCount(obs) <= 2;
};

/** Are you allowed to SHOOT right now? false = on cooldown. */
globalThis.canShoot = function canShoot(obs) {
  return (obs.self.shootCooldown ?? 0) === 0;
};

/** Are you allowed to DASH right now? false = on cooldown. */
globalThis.canDash = function canDash(obs) {
  return (obs.self.dashCooldown ?? 0) === 0;
};

/**
 * Suggest a DASH direction that gets us out of harm's way RIGHT NOW.
 * Returns "UP"|"DOWN"|"LEFT"|"RIGHT" or null. Picks the cardinal that:
 *   1. Is legal for at least 1 cell, and
 *   2. Has the fewest visible bots and no incoming bullet aiming our way.
 *
 * Use as a panic button when low-HP + threatened. Pair with `canDash(obs)`.
 */
globalThis.bestDashDir = function bestDashDir(obs) {
  if (!globalThis.canDash(obs)) return null;
  const enemies = globalThis.visibleBots(obs);
  const incoming = globalThis.incomingBullets(obs);
  const dirVec = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };
  let best = null, bestScore = -Infinity;
  for (const d of globalThis.DIRS) {
    if (!globalThis.canMove(obs, d)) continue;
    const [vx, vy] = dirVec[d];
    let score = 0;
    // Penalize moving toward enemies.
    for (const e of enemies) score -= Math.max(0, Math.sign(e.dx) * vx + Math.sign(e.dy) * vy);
    // Penalize stepping into a bullet's path.
    for (const b of incoming) score -= Math.max(0, vx * Math.sign(b.vx) + vy * Math.sign(b.vy));
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
};

/**
 * Best SHOOT target right now — returns { dx, dy } offset to the nearest
 * visible enemy bot, or null if none / on cooldown. Bullets travel in a
 * straight line at any angle, so any visible enemy is a valid target.
 *
 * Pass directly into the action: `{ type: "SHOOT", target: bestShootTarget(obs) }`.
 */
globalThis.bestShootTarget = function bestShootTarget(obs) {
  if (!globalThis.canShoot(obs)) return null;
  const enemy = globalThis.nearestBot(obs);
  if (!enemy) return null;
  return { dx: enemy.dx, dy: enemy.dy };
};

/**
 * Back-compat alias — returns the SHOOT target (was a 4-way direction string
 * before arbitrary-angle shooting). Kept so old bots that used `bestShootDir`
 * still work; new bots should use `bestShootTarget`.
 */
globalThis.bestShootDir = function bestShootDir(obs) {
  return globalThis.bestShootTarget(obs);
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
const learn = typeof mod.learn === "function" ? mod.learn : null;
if (typeof decide !== "function") {
  process.stderr.write("Bot must default-export a `decide(observation, state)` function.\n");
  process.exit(1);
}

// `state.params` is the persistent, versioned blob the runner loads before
// the first tick (via __init__) and reads back after the last tick (via
// __finalize__). Bots can write to state.params during play; whatever's there
// when the match ends is saved as a new version to bot_params.
const state = { params: {} };
const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  // Setup message: hydrate state.params before any tick. No reply.
  if (msg && msg.__init__) {
    state.params = msg.params ?? {};
    return;
  }

  // Teardown message: optionally call learn(info, state) so the bot can
  // book its end-of-match outcome (placement, won, etc.) into state.params,
  // then emit state.params and exit cleanly.
  if (msg && msg.__finalize__) {
    if (learn) {
      try { learn(msg.info ?? {}, state); } catch { /* swallow — params still written */ }
    }
    process.stdout.write(JSON.stringify({ __params__: state.params ?? null }) + "\n");
    process.exit(0);
  }

  // Otherwise: ordinary observation → action.
  let action;
  try {
    action = decide(msg, state);
    if (!action || typeof action !== "object" || typeof action.type !== "string") {
      action = { type: "WAIT" };
    }
  } catch {
    action = { type: "WAIT" };
  }
  process.stdout.write(JSON.stringify(action) + "\n");
});

rl.on("close", () => process.exit(0));
