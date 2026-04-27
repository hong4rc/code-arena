import { rngInt } from "./rng.ts";
import { DEFAULT_CONFIG } from "./types.ts";

import type { Bot, Cell, GameConfig, ItemKind, World } from "./types.ts";

export interface CreateWorldOptions {
  botIds: string[];
  config?: Partial<GameConfig>;
  seed?: number;
}

export function createBot(id: string, pos: Cell, config: GameConfig): Bot {
  return {
    id,
    pos,
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
    strikes: 0,
    forfeited: false,
  };
}

export function mergeConfig(partial?: Partial<GameConfig>): GameConfig {
  return { ...DEFAULT_CONFIG, ...partial, items: { ...DEFAULT_CONFIG.items, ...partial?.items } };
}

export function createWorld(opts: CreateWorldOptions): World {
  const config = mergeConfig(opts.config);
  const seed = opts.seed ?? 1;

  const bots = new Map<string, Bot>();
  const taken = new Set<string>();
  let rngState = seed;

  for (const id of opts.botIds) {
    let pos: Cell;
    let attempts = 0;
    do {
      const xr = rngInt(rngState, config.width);
      rngState = xr.state;
      const yr = rngInt(rngState, config.height);
      rngState = yr.state;
      pos = { x: xr.value, y: yr.value };
      attempts++;
      if (attempts > 1000) throw new Error("createWorld: cannot place bot — grid too crowded");
    } while (taken.has(`${pos.x},${pos.y}`));
    taken.add(`${pos.x},${pos.y}`);
    bots.set(id, createBot(id, pos, config));
  }

  return {
    width: config.width,
    height: config.height,
    tick: 0,
    maxTicks: config.maxTicks,
    bots,
    items: new Map(),
    itemCounter: 0,
    rngState,
  };
}

export function inBounds(world: World, c: Cell): boolean {
  return c.x >= 0 && c.x < world.width && c.y >= 0 && c.y < world.height;
}

export function botAt(world: World, c: Cell): Bot | undefined {
  for (const b of world.bots.values()) {
    if (b.alive && b.pos.x === c.x && b.pos.y === c.y) return b;
  }
  return undefined;
}

export function itemAt(world: World, c: Cell): { id: string; kind: ItemKind } | undefined {
  for (const it of world.items.values()) {
    if (it.pos.x === c.x && it.pos.y === c.y) return { id: it.id, kind: it.kind };
  }
  return undefined;
}
