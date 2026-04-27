import { rngInt, rngNext } from "./rng.ts";
import { botAt, botCells, fitsInBounds, footprintsOverlap, inBounds, inZone, itemAt } from "./world.ts";

import type {
  Action,
  ActionFailureReason,
  Bot,
  Bullet,
  Cell,
  Direction,
  GameConfig,
  ItemKind,
  ResolvedAction,
  World,
} from "./types.ts";

export interface BotInput {
  botId: string;
  action: Action;
  /** Set if the bot's response was bad protocol (counts toward strikes). */
  protocolError?: "timeout" | "crash" | "malformed";
}

const DIR_VECTORS: Record<Direction, Cell> = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
};

function offset(c: Cell, d: Direction, dist = 1): Cell {
  const v = DIR_VECTORS[d];
  return { x: c.x + v.x * dist, y: c.y + v.y * dist };
}

/**
 * Cell at `step` cells from `start` along the line to `start + (vx, vy)`,
 * using max-axis DDA — each step advances exactly 1 cell on the major axis.
 * step=0 returns start; step=1 returns the first cell along the line; etc.
 */
function lineCellAt(start: Cell, vx: number, vy: number, step: number): Cell {
  const ax = Math.abs(vx);
  const ay = Math.abs(vy);
  const len = Math.max(ax, ay);
  if (len === 0) return { ...start };
  // round half-away-from-zero (matches Math.round for positives, mirrors for negatives)
  const r = (n: number) => (n >= 0 ? Math.floor(n + 0.5) : -Math.floor(-n + 0.5));
  return {
    x: start.x + r((vx * step) / len),
    y: start.y + r((vy * step) / len),
  };
}

/**
 * Cells along the bot's leading edge in direction `d`. For a 2×2 bot moving
 * RIGHT, this returns the 2 cells on the right side of its footprint.
 */
function edgeCells(bot: Bot, d: Direction): Cell[] {
  const cells: Cell[] = [];
  switch (d) {
    case "RIGHT": {
      for (let i = 0; i < bot.size; i++) cells.push({ x: bot.pos.x + bot.size - 1, y: bot.pos.y + i });
      break;
    }
    case "LEFT": {
      for (let i = 0; i < bot.size; i++) cells.push({ x: bot.pos.x, y: bot.pos.y + i });
      break;
    }
    case "DOWN": {
      for (let i = 0; i < bot.size; i++) cells.push({ x: bot.pos.x + i, y: bot.pos.y + bot.size - 1 });
      break;
    }
    case "UP": {
      for (let i = 0; i < bot.size; i++) cells.push({ x: bot.pos.x + i, y: bot.pos.y });
      break;
    }
  }
  return cells;
}

/**
 * When a bot dies it drops its weapons (and only weapons) onto the map at the
 * top-left footprint cell — anyone who walks there next tick can PICKUP. We
 * drop only WEAPON because that's the gear that tilts the meta most; HEAL /
 * SHIELD / SPEED_BOOST get consumed in life and don't make sense to recover.
 */
function dropOnDeath(world: World, bot: Bot): void {
  if (!bot.alive) {
    const cell = { x: bot.pos.x, y: bot.pos.y };
    let placed = false;
    for (const item of bot.inventory) {
      if (item !== "WEAPON") continue;
      // Stack at most one item per cell — itemAt() blocks duplicates anyway.
      if (placed || itemAt(world, cell)) break;
      world.itemCounter += 1;
      world.items.set(`i${world.itemCounter}`, { id: `i${world.itemCounter}`, kind: "WEAPON", pos: cell });
      placed = true;
    }
    bot.inventory = [];
  }
}

function attackRange(bot: Bot, config: GameConfig): number {
  return bot.inventory.includes("WEAPON") ? config.baseAttackRange + config.items.weapon.rangeBonus : config.baseAttackRange;
}

function attackDamage(bot: Bot, config: GameConfig): number {
  return bot.inventory.includes("WEAPON") ? bot.attack + config.items.weapon.attackBonus : bot.attack;
}

interface MoveIntent {
  bot: Bot;
  from: Cell;
  to: Cell;
  action: Action;
  fail?: ActionFailureReason;
}

/**
 * Apply one tick of inputs to the world, mutating it in place.
 * Returns the resolved actions (for replay).
 */
export function resolveTick(world: World, inputs: BotInput[], config: GameConfig): ResolvedAction[] {
  const resolved: ResolvedAction[] = [];
  const inputById = new Map<string, BotInput>();
  for (const inp of inputs) inputById.set(inp.botId, inp);

  // 1. Strike accounting + forfeit handling.
  for (const bot of world.bots.values()) {
    if (!bot.alive) continue;
    const inp = inputById.get(bot.id);
    if (inp?.protocolError) {
      bot.strikes += 1;
      if (bot.strikes >= 3) bot.forfeited = true;
    }
  }

  // 2. Decay temporary effects.
  for (const bot of world.bots.values()) {
    if (!bot.alive) continue;
    if (bot.speedBoostTicks > 0) {
      bot.speedBoostTicks -= 1;
      if (bot.speedBoostTicks === 0) {
        bot.speed = Math.max(config.startSpeed, bot.speed - config.items.speedBoost.speedBonus);
      }
    }
  }

  // 3. Phase: USE actions (apply before move/attack so heal can save you).
  for (const bot of world.bots.values()) {
    const inp = inputById.get(bot.id);
    if (!bot || !bot.alive || bot.forfeited) {
      if (bot && !bot.alive) continue;
      if (bot?.forfeited) {
        resolved.push({ botId: bot.id, attempted: inp?.action ?? { type: "WAIT" }, applied: { type: "WAIT" }, reason: "forfeited" });
        continue;
      }
    }
    if (!inp || inp.action.type !== "USE") continue;
    const item: ItemKind = inp.action.item;
    const idx = bot.inventory.indexOf(item);
    if (idx === -1) {
      resolved.push({ botId: bot.id, attempted: inp.action, applied: { type: "WAIT" }, reason: "item-not-in-inventory" });
      continue;
    }
    // WEAPON is passive while held; "using" it is illegal — short-circuit before mutating inventory.
    if (item === "WEAPON") {
      resolved.push({ botId: bot.id, attempted: inp.action, applied: { type: "WAIT" }, reason: "item-not-in-inventory" });
      continue;
    }
    bot.inventory.splice(idx, 1);
    switch (item) {
      case "HEAL": {
        bot.hp = Math.min(bot.maxHp, bot.hp + config.items.heal.hp);
        break;
      }
      case "SHIELD": {
        bot.shieldHp = Math.max(bot.shieldHp, config.items.shield.absorbHp);
        break;
      }
      case "SPEED_BOOST": {
        bot.speed += config.items.speedBoost.speedBonus;
        bot.speedBoostTicks = config.items.speedBoost.ticks;
        break;
      }
    }
    resolved.push({ botId: bot.id, attempted: inp.action, applied: inp.action });
  }

  // 3b. Phase: DASH — cardinal sprint up to `dashRange` cells. Walks one cell
  // at a time, stopping just before the first cell that would overlap another
  // bot or leave the grid. Resolved sequentially per bot (no two-bot contention
  // logic) — fast cumulative motion, with cooldown so it can't be spammed.
  for (const bot of world.bots.values()) {
    if (!bot.alive || bot.forfeited) continue;
    const inp = inputById.get(bot.id);
    if (!inp || inp.action.type !== "DASH") continue;
    if (bot.dashCooldown > 0) {
      resolved.push({ botId: bot.id, attempted: inp.action, applied: { type: "WAIT" }, reason: "dash-on-cooldown" });
      continue;
    }
    let lastLegal = bot.pos;
    for (let step = 1; step <= config.dashRange; step++) {
      const candidate = offset(bot.pos, inp.action.dir, step);
      if (!fitsInBounds(world, candidate, bot.size)) break;
      let blocked = false;
      for (const other of world.bots.values()) {
        if (other.id === bot.id || !other.alive) continue;
        if (footprintsOverlap(candidate, bot.size, other.pos, other.size)) { blocked = true; break; }
      }
      if (blocked) break;
      lastLegal = candidate;
    }
    if (lastLegal.x === bot.pos.x && lastLegal.y === bot.pos.y) {
      resolved.push({ botId: bot.id, attempted: inp.action, applied: { type: "WAIT" }, reason: "blocked-by-bot" });
      continue;
    }
    bot.pos = lastLegal;
    bot.dashCooldown = config.dashCooldownTicks + 1;
    resolved.push({ botId: bot.id, attempted: inp.action, applied: inp.action });
  }

  // 4. Phase: collect MOVE intents, resolve collisions for multi-cell footprints.
  const moves: MoveIntent[] = [];
  for (const bot of world.bots.values()) {
    if (!bot.alive || bot.forfeited) continue;
    const inp = inputById.get(bot.id);
    if (!inp || inp.action.type !== "MOVE") continue;
    const to = offset(bot.pos, inp.action.dir, 1);
    if (!fitsInBounds(world, to, bot.size)) {
      moves.push({ bot, from: bot.pos, to: bot.pos, action: inp.action, fail: "off-grid" });
      continue;
    }
    moves.push({ bot, from: bot.pos, to, action: inp.action });
  }

  // Two bots aiming for footprints that would overlap → both blocked.
  for (let i = 0; i < moves.length; i++) {
    if (moves[i]!.fail) continue;
    for (let j = i + 1; j < moves.length; j++) {
      if (moves[j]!.fail) continue;
      if (footprintsOverlap(moves[i]!.to, moves[i]!.bot.size, moves[j]!.to, moves[j]!.bot.size)) {
        moves[i]!.fail = "blocked-by-bot";
        moves[j]!.fail = "blocked-by-bot";
      }
    }
  }

  // Stationary bots stay where they are. Block any move that would overlap them.
  const movingIds = new Set(moves.map((m) => m.bot.id));
  for (const m of moves) {
    if (m.fail) continue;
    for (const other of world.bots.values()) {
      if (!other.alive || movingIds.has(other.id)) continue;
      if (footprintsOverlap(m.to, m.bot.size, other.pos, other.size)) {
        m.fail = "blocked-by-bot";
        break;
      }
    }
  }

  // Apply successful moves.
  for (const m of moves) {
    if (m.fail) {
      resolved.push({ botId: m.bot.id, attempted: m.action, applied: { type: "WAIT" }, reason: m.fail });
    } else {
      m.bot.pos = m.to;
      resolved.push({ botId: m.bot.id, attempted: m.action, applied: m.action });
    }
  }

  // 5. Phase: ATTACK actions — scan from every border cell of the attacker's
  // footprint along `dir`. Hits the first non-self bot in range.
  for (const bot of world.bots.values()) {
    if (!bot.alive || bot.forfeited) continue;
    const inp = inputById.get(bot.id);
    if (!inp || inp.action.type !== "ATTACK") continue;
    const range = attackRange(bot, config);
    let target: Bot | undefined;
    outer: for (const start of edgeCells(bot, inp.action.dir)) {
      for (let d = 1; d <= range; d++) {
        const c = offset(start, inp.action.dir, d);
        if (!inBounds(world, c)) continue;
        const t = botAt(world, c);
        if (t && t.id !== bot.id) { target = t; break outer; }
      }
    }
    if (!target) {
      resolved.push({ botId: bot.id, attempted: inp.action, applied: { type: "WAIT" }, reason: "no-target-in-range" });
      continue;
    }
    const damage = attackDamage(bot, config);
    let remaining = damage;
    if (target.shieldHp > 0) {
      const absorbed = Math.min(target.shieldHp, remaining);
      target.shieldHp -= absorbed;
      remaining -= absorbed;
    }
    target.hp -= remaining;
    bot.damageDealt += damage;
    if (target.hp <= 0) { target.alive = false; target.diedAtTick = world.tick; dropOnDeath(world, target); }
    resolved.push({ botId: bot.id, attempted: inp.action, applied: inp.action });
  }

  // 5b. Phase: SHOOT actions — spawn new bullets at the shooter's cell.
  for (const bot of world.bots.values()) {
    if (!bot.alive || bot.forfeited) continue;
    const inp = inputById.get(bot.id);
    if (!inp || inp.action.type !== "SHOOT") continue;
    if (bot.shootCooldown > 0) {
      resolved.push({ botId: bot.id, attempted: inp.action, applied: { type: "WAIT" }, reason: "shoot-on-cooldown" });
      continue;
    }
    const tgt = inp.action.target;
    const dx = tgt?.dx;
    const dy = tgt?.dy;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
      resolved.push({ botId: bot.id, attempted: inp.action, applied: { type: "WAIT" }, reason: "shoot-bad-target" });
      continue;
    }
    world.bulletCounter += 1;
    // Spawn from the bot's center cell. The bot's `target` is an offset from
    // bot.pos (matching the observation frame), so we resolve it to an absolute
    // cell and aim the bullet AT that cell — otherwise the half-bot offset
    // between bot.pos and spawnFrom skews every shot by 1 cell.
    const half = Math.floor(bot.size / 2);
    const spawnFrom: Cell = { x: bot.pos.x + half, y: bot.pos.y + half };
    const targetCell: Cell = { x: bot.pos.x + Math.trunc(dx), y: bot.pos.y + Math.trunc(dy) };
    const bullet: Bullet = {
      id: `b${world.bulletCounter}`,
      pos: { ...spawnFrom },
      start: { ...spawnFrom },
      vx: targetCell.x - spawnFrom.x,
      vy: targetCell.y - spawnFrom.y,
      step: 0,
      ownerId: bot.id,
      damage: config.bullets.damage,
      remainingRange: config.bullets.maxRange,
    };
    world.bullets.set(bullet.id, bullet);
    // +1 because we decrement at end of this same tick. With cooldownTicks=1,
    // the bot is blocked on exactly the next tick.
    bot.shootCooldown = config.bullets.cooldownTicks + 1;
    resolved.push({ botId: bot.id, attempted: inp.action, applied: inp.action });
  }

  // 5c. Phase: advance existing bullets, check hits.
  advanceBullets(world, config);

  // Decrement cooldowns at end of tick — done after SHOOT spawn so shooter
  // can't immediately shoot again next tick.
  for (const bot of world.bots.values()) {
    if (bot.shootCooldown > 0) bot.shootCooldown -= 1;
    if (bot.dashCooldown > 0) bot.dashCooldown -= 1;
  }

  // 6. Phase: PICKUP actions — bot collects an item under any of its footprint cells.
  const claimedItems = new Set<string>();
  for (const bot of world.bots.values()) {
    if (!bot.alive || bot.forfeited) continue;
    const inp = inputById.get(bot.id);
    if (!inp || inp.action.type !== "PICKUP") continue;
    let picked: { id: string; kind: ItemKind } | undefined;
    for (const c of botCells(bot)) {
      const it = itemAt(world, c);
      if (it && !claimedItems.has(it.id)) { picked = it; break; }
    }
    if (!picked) {
      resolved.push({ botId: bot.id, attempted: inp.action, applied: { type: "WAIT" }, reason: "no-item-here" });
      continue;
    }
    claimedItems.add(picked.id);
    world.items.delete(picked.id);
    bot.inventory.push(picked.kind);
    bot.itemsPicked += 1;
    resolved.push({ botId: bot.id, attempted: inp.action, applied: inp.action });
  }

  // 7. Phase: WAIT (and any unhandled inputs).
  for (const bot of world.bots.values()) {
    if (!bot.alive) continue;
    if (resolved.some((r) => r.botId === bot.id)) continue;
    const inp = inputById.get(bot.id);
    resolved.push({
      botId: bot.id,
      attempted: inp?.action ?? { type: "WAIT" },
      applied: { type: "WAIT" },
      ...(inp?.protocolError ? { protocolError: inp.protocolError } : {}),
    });
  }

  // 8. Spawn new items (deterministic per RNG state).
  spawnItems(world, config);

  // 8b. Shrink the play zone (PUBG-style) and damage anyone outside it.
  applyZone(world, config);

  // 9. Advance tick.
  world.tick += 1;

  return resolved;
}

/**
 * Advance every bullet `bullet.config.speed` cells along its direction. Stop
 * at the first bot in the path (deal damage, despawn) or when out of map / range.
 */
function advanceBullets(world: World, config: GameConfig): void {
  const toRemove: string[] = [];
  for (const bullet of world.bullets.values()) {
    let hit = false;
    for (let s = 0; s < config.bullets.speed; s++) {
      // Step one cell along the major axis. lineCellAt picks the next cell on
      // the line; if rounding produces the same cell as before, skip ahead
      // without consuming range so each tick still advances visibly.
      let next: Cell;
      let safety = 4;
      do {
        bullet.step += 1;
        next = lineCellAt(bullet.start, bullet.vx, bullet.vy, bullet.step);
        safety -= 1;
      } while (safety > 0 && next.x === bullet.pos.x && next.y === bullet.pos.y);
      bullet.pos = next;
      bullet.remainingRange -= 1;

      if (!inBounds(world, bullet.pos)) { toRemove.push(bullet.id); break; }

      const target = botAt(world, bullet.pos);
      if (target && target.id !== bullet.ownerId) {
        let remaining = bullet.damage;
        if (target.shieldHp > 0) {
          const absorbed = Math.min(target.shieldHp, remaining);
          target.shieldHp -= absorbed;
          remaining -= absorbed;
        }
        target.hp -= remaining;
        const owner = world.bots.get(bullet.ownerId);
        if (owner) owner.damageDealt += bullet.damage;
        if (target.hp <= 0) { target.alive = false; target.diedAtTick = world.tick; dropOnDeath(world, target); }
        toRemove.push(bullet.id);
        hit = true;
        break;
      }

      if (bullet.remainingRange <= 0) { toRemove.push(bullet.id); break; }
    }
    if (hit) continue;
  }
  for (const id of toRemove) world.bullets.delete(id);
}

/**
 * Zone logic — PUBG-style shrinking blue zone.
 *
 *  - Bots outside `world.zone` take damage every tick.
 *  - The next zone (`world.nextZone`) is a *random* sub-rectangle of the
 *    current zone, announced one shrink-period ahead. PUBG calls this the
 *    "white circle"; bots can plan a route to it.
 *  - At each shrink-due tick, we apply the announced nextZone (current = next)
 *    and roll a fresh nextZone for the one after.
 *  - From `suddenDeathTick`, the zone collapses to "no safe cell" and every
 *    bot bleeds every tick.
 */
function applyZone(world: World, config: GameConfig): void {
  const z = config.zone;
  const inSuddenDeath = z.suddenDeathTick > 0 && world.tick >= z.suddenDeathTick;

  // 1. Damage phase — outside the current safe zone hurts.
  for (const bot of world.bots.values()) {
    if (!bot.alive) continue;
    if (inSuddenDeath || !inZone(world.zone, bot.pos)) {
      bot.hp -= z.damagePerTickOutside;
      if (bot.hp <= 0) { bot.alive = false; bot.diedAtTick = world.tick; dropOnDeath(world, bot); }
    }
  }

  // 2. Sudden death: collapse zone, no further announcements.
  if (inSuddenDeath) {
    world.zone = { xMin: 1, yMin: 1, xMax: 0, yMax: 0 };
    world.nextZone = null;
    world.nextShrinkAtTick = null;
    return;
  }

  // 3. Schedule check.
  if (world.tick < z.graceTicks) return;
  if ((world.tick - z.graceTicks) % z.shrinkEveryTicks !== 0) return;

  // Apply previously-announced next zone, if any.
  if (world.nextZone) {
    world.zone = world.nextZone;
  }

  // Roll a new nextZone (or null if we can't shrink further).
  world.nextZone = pickNextZone(world, z.shrinkAmount);
  world.nextShrinkAtTick = world.nextZone ? world.tick + z.shrinkEveryTicks : null;
}

/** Random sub-rectangle of `world.zone`, smaller by `shrink` on each side. */
function pickNextZone(world: World, shrink: number): { xMin: number; yMin: number; xMax: number; yMax: number } | null {
  const cur = world.zone;
  const curW = cur.xMax - cur.xMin + 1;
  const curH = cur.yMax - cur.yMin + 1;
  const newW = curW - 2 * shrink;
  const newH = curH - 2 * shrink;
  // Already minimal — no more shrinking.
  if (newW < 1 || newH < 1) return null;
  if (newW >= curW && newH >= curH) return null;

  const slackX = curW - newW;
  const slackY = curH - newH;

  const ox = rngInt(world.rngState, slackX + 1);
  world.rngState = ox.state;
  const oy = rngInt(world.rngState, slackY + 1);
  world.rngState = oy.state;

  return {
    xMin: cur.xMin + ox.value,
    yMin: cur.yMin + oy.value,
    xMax: cur.xMin + ox.value + newW - 1,
    yMax: cur.yMin + oy.value + newH - 1,
  };
}

function spawnItems(world: World, config: GameConfig): void {
  // Respect the cap — when the map is "full" of unclaimed loot, stop spawning
  // until something gets picked up. Re-enables automatically next tick.
  if (world.items.size >= config.items.maxItems) return;

  const r = rngNext(world.rngState);
  world.rngState = r.state;
  if (r.value > config.items.spawnRatePerTick) return;

  const kinds: ItemKind[] = ["HEAL", "WEAPON", "SHIELD", "SPEED_BOOST"];
  const ki = rngInt(world.rngState, kinds.length);
  world.rngState = ki.state;
  const kind = kinds[ki.value] as ItemKind;

  // Find a random empty cell.
  for (let attempt = 0; attempt < 20; attempt++) {
    const xr = rngInt(world.rngState, world.width);
    world.rngState = xr.state;
    const yr = rngInt(world.rngState, world.height);
    world.rngState = yr.state;
    const cell = { x: xr.value, y: yr.value };
    if (botAt(world, cell)) continue;
    if (itemAt(world, cell)) continue;
    world.itemCounter += 1;
    const id = `i${world.itemCounter}`;
    world.items.set(id, { id, kind, pos: cell });
    return;
  }
}

export function isGameOver(world: World): boolean {
  if (world.tick >= world.maxTicks) return true;
  let alive = 0;
  for (const b of world.bots.values()) if (b.alive) alive++;
  return alive <= 1;
}

export function placements(world: World): { botId: string; placement: number }[] {
  const sorted = [...world.bots.values()].sort((a, b) => {
    // 1. Alive > dead
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    // 2. Among alive: more HP wins
    if (a.alive && b.alive && a.hp !== b.hp) return b.hp - a.hp;
    // 3. Among dead: died LATER wins (survived longer)
    if (!a.alive && !b.alive) {
      const ad = a.diedAtTick ?? -1;
      const bd = b.diedAtTick ?? -1;
      if (ad !== bd) return bd - ad;
    }
    // 4. Tiebreaker: more damage dealt wins
    return b.damageDealt - a.damageDealt;
  });
  return sorted.map((b, i) => ({ botId: b.id, placement: i + 1 }));
}
