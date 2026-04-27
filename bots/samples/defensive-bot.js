// defensive-bot — heals at low HP, runs from enemies, grabs items if safe.
export default function decide(obs) {
  // 1. Low HP? Heal if we can.
  if (lowHp(obs) && hasItem(obs, "HEAL")) {
    return { type: "USE", item: "HEAL" };
  }

  // 2. Enemy in any adjacent cell? Step the opposite way.
  const threats = adjacentBots(obs);
  if (threats.length > 0) {
    return { type: "MOVE", dir: opposite(threats[0].dir) };
  }

  // 3. Standing on an item? Grab it.
  if (canPickup(obs)) return { type: "PICKUP" };

  // 4. Walk toward the closest item.
  const item = nearestItem(obs);
  if (item) return { type: "MOVE", dir: dirTo(item.dx, item.dy) };

  // 5. Otherwise drift toward the safest direction.
  return { type: "MOVE", dir: safestDir(obs) };
}
