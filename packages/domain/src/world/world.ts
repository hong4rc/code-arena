import { rngInt } from "./rng.ts";
import { DEFAULT_CONFIG } from "./types.ts";

import type { Bot, Bullet, Cell, GameConfig, ItemKind, World, Zone } from "./types.ts";

export interface CreateWorldOptions {
  botIds: string[];
  config?: Partial<GameConfig>;
  seed?: number;
}

export function createBot(id: string, pos: Cell, config: GameConfig): Bot {
  return {
    id,
    pos,
    size: config.botSize,
    hp: config.startHp,
    maxHp: config.startHp,
    attack: config.startAttack,
    speed: config.startSpeed,
    inventory: [],
    shieldHp: 0,
    speedBoostTicks: 0,
    damageDealt: 0,
    itemsPicked: 0,
    alive: true,
    diedAtTick: null,
    strikes: 0,
    forfeited: false,
    shootCooldown: 0,
    dashCooldown: 0,
  };
}

export function mergeConfig(partial?: Partial<GameConfig>): GameConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    items: { ...DEFAULT_CONFIG.items, ...partial?.items },
    bullets: { ...DEFAULT_CONFIG.bullets, ...partial?.bullets },
    zone: { ...DEFAULT_CONFIG.zone, ...partial?.zone },
  };
}

/** All cells the bot's footprint covers, given its top-left pos and size. */
export function botCells(bot: Bot): Cell[] {
  const cells: Cell[] = [];
  for (let dy = 0; dy < bot.size; dy++) {
    for (let dx = 0; dx < bot.size; dx++) {
      cells.push({ x: bot.pos.x + dx, y: bot.pos.y + dy });
    }
  }
  return cells;
}

/** The bot's "center" cell (used for vision / shooting line / dirTo). */
export function botCenter(bot: Bot): Cell {
  const half = Math.floor(bot.size / 2);
  return { x: bot.pos.x + half, y: bot.pos.y + half };
}

/** Does the bot's footprint, if positioned at `topLeft`, fit fully inside the map? */
export function fitsInBounds(world: World, topLeft: Cell, size: number): boolean {
  return topLeft.x >= 0 && topLeft.y >= 0
    && topLeft.x + size <= world.width
    && topLeft.y + size <= world.height;
}

/** Do two square footprints (top-left x size) overlap? */
export function footprintsOverlap(aPos: Cell, aSize: number, bPos: Cell, bSize: number): boolean {
  return !(aPos.x + aSize <= bPos.x
        || bPos.x + bSize <= aPos.x
        || aPos.y + aSize <= bPos.y
        || bPos.y + bSize <= aPos.y);
}

export function createWorld(opts: CreateWorldOptions): World {
  const config = mergeConfig(opts.config);
  const seed = opts.seed ?? 1;
  const size = config.botSize;

  const bots = new Map<string, Bot>();
  let rngState = seed;

  for (const id of opts.botIds) {
    let pos: Cell;
    let attempts = 0;
    do {
      // Pick a top-left such that the footprint fits in the map.
      const xr = rngInt(rngState, Math.max(1, config.width - size + 1));
      rngState = xr.state;
      const yr = rngInt(rngState, Math.max(1, config.height - size + 1));
      rngState = yr.state;
      pos = { x: xr.value, y: yr.value };
      attempts++;
      if (attempts > 5000) throw new Error("createWorld: cannot place bot — grid too crowded");
      // Reject if it would overlap any already-placed bot.
      let overlap = false;
      for (const other of bots.values()) {
        if (footprintsOverlap(pos, size, other.pos, other.size)) { overlap = true; break; }
      }
      if (!overlap) break;
    // eslint-disable-next-line no-constant-condition
    } while (true);
    bots.set(id, createBot(id, pos, config));
  }

  return {
    width: config.width,
    height: config.height,
    tick: 0,
    maxTicks: config.maxTicks,
    bots,
    items: new Map(),
    bullets: new Map(),
    zone: { xMin: 0, yMin: 0, xMax: config.width - 1, yMax: config.height - 1 },
    nextZone: null,
    nextShrinkAtTick: null,
    itemCounter: 0,
    bulletCounter: 0,
    rngState,
  };
}

export function inBounds(world: World, c: Cell): boolean {
  return c.x >= 0 && c.x < world.width && c.y >= 0 && c.y < world.height;
}

export function inZone(zone: Zone, c: Cell): boolean {
  return c.x >= zone.xMin && c.x <= zone.xMax && c.y >= zone.yMin && c.y <= zone.yMax;
}

/** Returns the bot whose footprint covers `c`, if any. */
export function botAt(world: World, c: Cell): Bot | undefined {
  for (const b of world.bots.values()) {
    if (!b.alive) continue;
    if (c.x >= b.pos.x && c.x < b.pos.x + b.size && c.y >= b.pos.y && c.y < b.pos.y + b.size) {
      return b;
    }
  }
  return undefined;
}

export function itemAt(world: World, c: Cell): { id: string; kind: ItemKind } | undefined {
  for (const it of world.items.values()) {
    if (it.pos.x === c.x && it.pos.y === c.y) return { id: it.id, kind: it.kind };
  }
  return undefined;
}

export function bulletAt(world: World, c: Cell): Bullet | undefined {
  for (const b of world.bullets.values()) {
    if (b.pos.x === c.x && b.pos.y === c.y) return b;
  }
  return undefined;
}
