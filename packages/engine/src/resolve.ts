import { rngInt, rngNext } from "./rng.ts";
import { botAt, inBounds, itemAt } from "./world.ts";

import type {
  Action,
  ActionFailureReason,
  Bot,
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

  // 4. Phase: collect MOVE intents, resolve collisions.
  const moves: MoveIntent[] = [];
  for (const bot of world.bots.values()) {
    if (!bot.alive || bot.forfeited) continue;
    const inp = inputById.get(bot.id);
    if (!inp || inp.action.type !== "MOVE") continue;
    const to = offset(bot.pos, inp.action.dir, 1);
    if (!inBounds(world, to)) {
      moves.push({ bot, from: bot.pos, to: bot.pos, action: inp.action, fail: "off-grid" });
      continue;
    }
    moves.push({ bot, from: bot.pos, to, action: inp.action });
  }

  // Bot-bot collision: if two bots target same cell, both stay. If target cell is currently occupied
  // by a bot that is NOT moving, blocked.
  const targetCount = new Map<string, number>();
  for (const m of moves) targetCount.set(`${m.to.x},${m.to.y}`, (targetCount.get(`${m.to.x},${m.to.y}`) ?? 0) + 1);

  // Bots not moving stay in place.
  const occupiedAfter = new Map<string, Bot>();
  const movingIds = new Set(moves.map((m) => m.bot.id));
  for (const bot of world.bots.values()) {
    if (!bot.alive) continue;
    if (!movingIds.has(bot.id)) occupiedAfter.set(`${bot.pos.x},${bot.pos.y}`, bot);
  }

  for (const m of moves) {
    if (m.fail) continue;
    const key = `${m.to.x},${m.to.y}`;
    if ((targetCount.get(key) ?? 0) > 1) {
      m.fail = "blocked-by-bot";
      continue;
    }
    if (occupiedAfter.has(key)) {
      m.fail = "blocked-by-bot";
      continue;
    }
  }

  // Apply successful moves.
  for (const m of moves) {
    if (m.fail) {
      resolved.push({ botId: m.bot.id, attempted: m.action, applied: { type: "WAIT" }, reason: m.fail });
    } else {
      m.bot.pos = m.to;
      occupiedAfter.set(`${m.to.x},${m.to.y}`, m.bot);
      resolved.push({ botId: m.bot.id, attempted: m.action, applied: m.action });
    }
  }

  // 5. Phase: ATTACK actions resolve simultaneously.
  for (const bot of world.bots.values()) {
    if (!bot.alive || bot.forfeited) continue;
    const inp = inputById.get(bot.id);
    if (!inp || inp.action.type !== "ATTACK") continue;
    const range = attackRange(bot, config);
    let target: Bot | undefined;
    for (let d = 1; d <= range; d++) {
      const c = offset(bot.pos, inp.action.dir, d);
      if (!inBounds(world, c)) break;
      const t = botAt(world, c);
      if (t) {
        target = t;
        break;
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
    if (target.hp <= 0) target.alive = false;
    resolved.push({ botId: bot.id, attempted: inp.action, applied: inp.action });
  }

  // 6. Phase: PICKUP actions.
  const claimedItems = new Set<string>();
  for (const bot of world.bots.values()) {
    if (!bot.alive || bot.forfeited) continue;
    const inp = inputById.get(bot.id);
    if (!inp || inp.action.type !== "PICKUP") continue;
    const item = itemAt(world, bot.pos);
    if (!item || claimedItems.has(item.id)) {
      resolved.push({ botId: bot.id, attempted: inp.action, applied: { type: "WAIT" }, reason: "no-item-here" });
      continue;
    }
    claimedItems.add(item.id);
    world.items.delete(item.id);
    bot.inventory.push(item.kind);
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

  // 9. Advance tick.
  world.tick += 1;

  return resolved;
}

function spawnItems(world: World, config: GameConfig): void {
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
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (b.hp !== a.hp) return b.hp - a.hp;
    return b.damageDealt - a.damageDealt;
  });
  return sorted.map((b, i) => ({ botId: b.id, placement: i + 1 }));
}
