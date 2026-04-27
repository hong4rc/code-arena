import { botAt, inBounds, itemAt } from "./world.ts";

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

      const otherBot = botAt(world, cell);
      if (otherBot) {
        row.push({ kind: "bot", botId: otherBot.id, hp: otherBot.hp });
        continue;
      }

      const item = itemAt(world, cell);
      if (item) {
        row.push({ kind: "item", item: item.kind });
        continue;
      }

      row.push({ kind: "empty" });
    }
    view.push(row);
  }

  return {
    tick: world.tick,
    self: {
      x: bot.pos.x,
      y: bot.pos.y,
      hp: bot.hp,
      attack: bot.attack,
      speed: bot.speed,
      inventory: [...bot.inventory],
    },
    view,
    tickTimeMs: config.tickTimeMs,
  };
}
