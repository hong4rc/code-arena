// hunter-bot — chases and attacks the lowest-HP visible enemy.
import { runBot, findNearest, moveToward, adjacent, DIRS } from "./_sdk.js";

function decide(observation, _state) {
  // 1. Attack any adjacent enemy immediately.
  for (const dir of DIRS) {
    const c = adjacent(observation, dir);
    if (c?.kind === "bot") return { type: "ATTACK", dir };
  }

  // 2. Find lowest-HP visible enemy.
  const view = observation.view;
  const r = Math.floor(view.length / 2);
  let prey = null;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const cell = view[dy + r][dx + r];
      if (cell?.kind !== "bot") continue;
      if (!prey || (cell.hp ?? 100) < prey.hp) {
        prey = { dx, dy, hp: cell.hp ?? 100 };
      }
    }
  }
  if (prey) return { type: "MOVE", dir: moveToward(prey.dx, prey.dy) };

  // 3. Otherwise grab nearby weapon if one exists.
  const weapon = findNearest(observation, (c) => c.kind === "item" && c.item === "WEAPON");
  if (weapon) return { type: "MOVE", dir: moveToward(weapon.dx, weapon.dy) };

  return { type: "WAIT" };
}

runBot(decide);
