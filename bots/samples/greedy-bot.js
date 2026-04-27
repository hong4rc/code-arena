// greedy-bot — attack adjacent enemies, otherwise grab the nearest item.
export default function decide(obs) {
  // 1. Punch any enemy in attack range (handles WEAPON range automatically).
  for (const dir of DIRS) {
    if (canAttack(obs, dir)) return { type: "ATTACK", dir };
  }

  // 2. Standing on an item? Pick it up.
  if (canPickup(obs)) return { type: "PICKUP" };

  // 3. Walk toward the closest item we can see.
  const item = nearestItem(obs);
  if (item) return { type: "MOVE", dir: dirTo(item.dx, item.dy) };

  // 4. Nothing to grab — chase the nearest enemy.
  const enemy = nearestBot(obs);
  if (enemy) return { type: "MOVE", dir: dirTo(enemy.dx, enemy.dy) };

  return { type: "WAIT" };
}
