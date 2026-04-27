// defensive-bot — heals at low HP, flees from enemies, picks up items if safe.
import { runBot, findNearest, moveToward, adjacent, DIRS } from "./_sdk.js";

function decide(observation, _state) {
  const { self } = observation;

  // 1. If HP low and we have HEAL, use it.
  if (self.hp < 60 && self.inventory.includes("HEAL")) {
    return { type: "USE", item: "HEAL" };
  }

  // 2. If an enemy is adjacent, retreat in opposite direction.
  for (const dir of DIRS) {
    const c = adjacent(observation, dir);
    if (c?.kind === "bot") {
      const opposite = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" }[dir];
      return { type: "MOVE", dir: opposite };
    }
  }

  // 3. If standing on item, grab it.
  const r = Math.floor(observation.view.length / 2);
  if (observation.view[r][r]?.kind === "item") return { type: "PICKUP" };

  // 4. Path to nearest item.
  const item = findNearest(observation, (c) => c.kind === "item");
  if (item) return { type: "MOVE", dir: moveToward(item.dx, item.dy) };

  // 5. Flee from any visible enemy.
  const enemy = findNearest(observation, (c) => c.kind === "bot");
  if (enemy) return { type: "MOVE", dir: moveToward(-enemy.dx, -enemy.dy) };

  return { type: "WAIT" };
}

runBot(decide);
