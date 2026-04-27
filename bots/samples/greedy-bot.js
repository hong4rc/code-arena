// greedy-bot — HOARDER. Main objective: collect items, get rich, survive.
// Avoids combat unless cornered. Uses items defensively. The "looter" archetype.
export default function decide(obs, state) {
  const velocity = trackEnemies(obs, state);

  // ── ZONE: never bleed out ──────────────────────────────────────
  if (!inZone(obs)) return { type: "MOVE", dir: dirToZone(obs) };
  const tts = ticksUntilShrink(obs);
  if (tts !== null && tts <= 30 && !inNextZone(obs)) {
    const d = dirToNextZone(obs);
    if (d) return { type: "MOVE", dir: d };
  }

  // ── DEFENSE: protect the loot we've collected ──────────────────
  // Pop SHIELD when threatened.
  if ((adjacentBots(obs).length > 0 || incomingBullets(obs).length > 0)
      && hasItem(obs, "SHIELD")) {
    return { type: "USE", item: "SHIELD" };
  }
  // HEAL if hurt — keep our hoard alive.
  if (lowHp(obs, 0.5) && hasItem(obs, "HEAL")) {
    return { type: "USE", item: "HEAL" };
  }
  // Dodge incoming bullets perpendicular to their travel direction.
  const incoming = incomingBullets(obs);
  if (incoming.length > 0) {
    const b = incoming[0];
    const horizontal = Math.abs(b.vx) >= Math.abs(b.vy);
    const choices = horizontal ? ["UP", "DOWN"] : ["LEFT", "RIGHT"];
    for (const d of choices) if (canMove(obs, d)) return { type: "MOVE", dir: d };
  }

  // ── COMBAT: only retaliate when forced ─────────────────────────
  // Adjacent enemy? Fight back so we don't get pinned.
  for (const dir of DIRS) {
    if (canAttack(obs, dir)) return { type: "ATTACK", dir };
  }
  // Free shot at any visible enemy? Take it (SHOOT works without WEAPON).
  if (canShoot(obs)) {
    const enemy = nearestBot(obs);
    if (enemy) return { type: "SHOOT", target: leadShot(obs, enemy, velocity[enemy.botId], { bulletSpeed: 5 }) };
  }

  // ── THE OBJECTIVE: GRAB LOOT ──────────────────────────────────
  if (canPickup(obs)) return { type: "PICKUP" };

  // Prioritise items we're missing or need.
  const want = [];
  if (!hasItem(obs, "WEAPON")) want.push("WEAPON");
  if (!hasItem(obs, "HEAL")) want.push("HEAL");
  if (!hasItem(obs, "SHIELD")) want.push("SHIELD");
  if (!hasItem(obs, "SPEED_BOOST")) want.push("SPEED_BOOST");
  for (const kind of want) {
    const it = nearestItem(obs, kind);
    if (it) {
      const d = smartMove(obs, dirTo(it.dx, it.dy));
      if (d) return { type: "MOVE", dir: d };
    }
  }
  // Already have one of each? Just pile up extras.
  const any = nearestItem(obs);
  if (any) {
    const d = smartMove(obs, dirTo(any.dx, any.dy));
    if (d) return { type: "MOVE", dir: d };
  }

  // ── EVASION: avoid enemies actively, drift toward zone ────────
  const enemy = nearestBot(obs);
  if (enemy && enemy.dist <= 5) {
    // An enemy is close → flee, don't engage.
    const d = smartMove(obs, fleeFrom(enemy.dx, enemy.dy));
    if (d) return { type: "MOVE", dir: d };
  }
  return { type: "MOVE", dir: dirToNextZone(obs) ?? dirToZone(obs) };
}
