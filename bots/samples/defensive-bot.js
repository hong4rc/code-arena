// defensive-bot — heals at low HP, runs from enemies, grabs items if safe.
export default function decide(obs) {
  // 1. Low HP? Heal if we can.
  if (obs.self.hp < 60 && obs.self.inventory.includes("HEAL")) {
    return { type: "USE", item: "HEAL" };
  }

  // 2. Enemy next to us? Step away.
  for (const dir of DIRS) {
    if (adjacent(obs, dir)?.kind === "bot") {
      const opposite = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" };
      return { type: "MOVE", dir: opposite[dir] };
    }
  }

  // 3. Standing on an item? Grab it.
  if (here(obs)?.kind === "item") return { type: "PICKUP" };

  // 4. Walk toward the closest item.
  const item = nearestItem(obs);
  if (item) return { type: "MOVE", dir: dirTo(item.dx, item.dy) };

  // 5. Otherwise flee from the nearest visible enemy.
  const enemy = nearestBot(obs);
  if (enemy) return { type: "MOVE", dir: fleeFrom(enemy.dx, enemy.dy) };

  return { type: "WAIT" };
}
