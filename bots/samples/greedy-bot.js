// greedy-bot — attack adjacent enemies, otherwise grab the nearest item.
export default function decide(obs) {
  // 1. Punch any enemy standing next to us.
  for (const dir of DIRS) {
    if (adjacent(obs, dir)?.kind === "bot") {
      return { type: "ATTACK", dir };
    }
  }

  // 2. Standing on an item? Pick it up.
  if (here(obs)?.kind === "item") {
    return { type: "PICKUP" };
  }

  // 3. Otherwise walk toward the closest item we can see.
  const item = nearestItem(obs);
  if (item) return { type: "MOVE", dir: dirTo(item.dx, item.dy) };

  // 4. Nothing to grab — chase the nearest enemy.
  const enemy = nearestBot(obs);
  if (enemy) return { type: "MOVE", dir: dirTo(enemy.dx, enemy.dy) };

  return { type: "WAIT" };
}
