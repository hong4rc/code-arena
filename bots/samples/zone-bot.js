// zone-bot — zone-runner. Always moves toward the safest place on the map.
// Priority: get inside the announced *next* zone before the shrink, then sit
// at the center of the current zone. Only fights when something is right in
// its face. Wins by outliving everyone who got greedy and stayed outside.
export default function decide(obs, state) {
  const velocity = trackEnemies(obs, state);
  // 0. Use HEAL if we're bleeding out.
  if (lowHp(obs, 0.3) && hasItem(obs, "HEAL")) {
    return { type: "USE", item: "HEAL" };
  }

  // 1. Pick up anything underneath us — costs no detour.
  if (canPickup(obs)) return { type: "PICKUP" };

  // 2. If we're outside the current zone, run to its center NOW (we're losing HP).
  if (!inZone(obs)) {
    return { type: "MOVE", dir: dirToZone(obs) };
  }

  // 3. A shrink is coming and we're not inside the next zone yet → move there.
  //    nextZone is only revealed in the second half of the cycle, so by the
  //    time we see it we have enough ticks to walk in.
  if (!inNextZone(obs)) {
    const dir = dirToNextZone(obs);
    if (dir) return { type: "MOVE", dir };
  }

  // 4. Self-defense only: if an enemy is adjacent, hit them; else shoot if aligned.
  const adj = adjacentBots(obs);
  if (adj.length > 0) return { type: "ATTACK", dir: adj[0].dir };
  if (canShoot(obs)) {
    const enemy = nearestBot(obs);
    if (enemy) return { type: "SHOOT", target: leadShot(obs, enemy, velocity[enemy.botId], { bulletSpeed: 5 }) };
  }

  // 5. Drift to the center of the current zone — keeps us safe through the next shrink.
  const cx = (obs.zone.xMin + obs.zone.xMax) / 2;
  const cy = (obs.zone.yMin + obs.zone.yMax) / 2;
  const dx = cx - obs.self.x;
  const dy = cy - obs.self.y;
  if (Math.abs(dx) + Math.abs(dy) >= 1) {
    return { type: "MOVE", dir: dirTo(dx, dy) };
  }

  // 6. Already centered. Wait.
  return { type: "WAIT" };
}
