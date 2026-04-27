// greedy-bot — moves toward nearest visible item, attacks adjacent enemies.
import { runBot, findNearest, moveToward, adjacent, DIRS } from "./_sdk.js";

function decide(observation, _state) {
  // 1. If an enemy is in an adjacent cell, attack it.
  for (const dir of DIRS) {
    const c = adjacent(observation, dir);
    if (c?.kind === "bot") return { type: "ATTACK", dir };
  }

  // 2. If standing on an item, pick it up.
  const r = Math.floor(observation.view.length / 2);
  if (observation.view[r][r]?.kind === "item") return { type: "PICKUP" };

  // 3. Move toward nearest visible item.
  const item = findNearest(observation, (c) => c.kind === "item");
  if (item) return { type: "MOVE", dir: moveToward(item.dx, item.dy) };

  // 4. Otherwise wander toward nearest enemy.
  const enemy = findNearest(observation, (c) => c.kind === "bot");
  if (enemy) return { type: "MOVE", dir: moveToward(enemy.dx, enemy.dy) };

  return { type: "WAIT" };
}

runBot(decide);
