import { botAt, bulletAt, inBounds, itemAt } from "./world.ts";

import type { Bot, GameConfig, Observation, ObservedCell, World } from "./types.ts";

export function buildObservation(world: World, bot: Bot, config: GameConfig): Observation {
  const r = config.visionRadius;
  const view: ObservedCell[][] = [];

  for (let dy = -r; dy <= r; dy++) {
    const row: ObservedCell[] = [];
    for (let dx = -r; dx <= r; dx++) {
      const x = bot.pos.x + dx;
      const y = bot.pos.y + dy;
      const cell = { x, y };

      if (!inBounds(world, cell)) {
        row.push({ kind: "wall" });
        continue;
      }

      // Bullets render BEFORE bots so they're visible even on the same cell.
      const bullet = bulletAt(world, cell);
      if (bullet) {
        row.push({ kind: "bullet", vx: bullet.vx, vy: bullet.vy, ownerId: bullet.ownerId });
        continue;
      }

      const otherBot = botAt(world, cell);
      if (otherBot && otherBot.id !== bot.id) {
        row.push({ kind: "bot", botId: otherBot.id, hp: otherBot.hp });
        continue;
      }

      // Items render even when sitting under our own footprint — otherwise a
      // multi-cell bot that moves onto an item can't see it and never PICKUPs.
      const item = itemAt(world, cell);
      if (item) {
        row.push({ kind: "item", item: item.kind });
        continue;
      }

      // Own-footprint cells: render as empty (not as enemy bot).
      // `obs.self` already tells the bot where it is.
      row.push({ kind: "empty" });
    }
    view.push(row);
  }

  // Only reveal the announced nextZone in the second half of the cycle.
  // Before that, bots see only ticksUntilShrink (a warning, not the route).
  // PUBG-style: you know a shrink is coming, but not yet WHERE it'll close.
  const ticksUntilShrink = world.nextShrinkAtTick === null
    ? null
    : world.nextShrinkAtTick - world.tick;
  const halfCycle = Math.floor(config.zone.shrinkEveryTicks / 2);
  const revealNext = ticksUntilShrink !== null && ticksUntilShrink <= halfCycle;

  return {
    tick: world.tick,
    self: {
      x: bot.pos.x,
      y: bot.pos.y,
      size: bot.size,
      hp: bot.hp,
      attack: bot.attack,
      speed: bot.speed,
      inventory: [...bot.inventory],
      shootCooldown: bot.shootCooldown,
      dashCooldown: bot.dashCooldown,
    },
    view,
    zone: {
      ...world.zone,
      nextZone: revealNext && world.nextZone ? { ...world.nextZone } : null,
      ticksUntilShrink,
    },
    roster: [...world.bots.values()].map((b) => ({ id: b.id, alive: b.alive })),
    tickTimeMs: config.tickTimeMs,
  };
}
