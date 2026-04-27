// hunter-bot — KILLER. Main objective: rack up kills.
// Aggressively pursues the weakest enemy. Doesn't waste actions on heals or
// shields when it could be shooting. Wins by being the most efficient at violence.
export default function decide(obs, state) {
  const velocity = trackEnemies(obs, state);

  // ── ZONE: only minimal compliance — combat first, zone second ──
  if (!inZone(obs)) return { type: "MOVE", dir: dirToZone(obs) };
  const tts = ticksUntilShrink(obs);
  if (tts !== null && tts <= 20 && !inNextZone(obs)) {
    // Tighter window than other bots — hunter trusts itself to make it.
    const d = dirToNextZone(obs);
    if (d) return { type: "MOVE", dir: d };
  }

  // ── PRIORITISE FINISHING BLOWS ─────────────────────────────────
  // Adjacent kill? Take it (regardless of HP).
  for (const dir of DIRS) {
    if (canKill(obs, dir)) return { type: "ATTACK", dir };
  }

  // ── MELEE / RANGED COMBAT ──────────────────────────────────────
  for (const dir of DIRS) {
    if (canAttack(obs, dir)) return { type: "ATTACK", dir };
  }
  // Lead the bullet at the weakest visible enemy.
  if (canShoot(obs)) {
    const enemies = visibleBots(obs);
    if (enemies.length > 0) {
      const prey = enemies.reduce((a, b) => (a.hp <= b.hp ? a : b));
      return { type: "SHOOT", target: leadShot(obs, prey, velocity[prey.botId], { bulletSpeed: 5 }) };
    }
  }

  // ── EMERGENCY HEAL ─────────────────────────────────────────────
  // Hunter only heals when really dying (other bots heal earlier).
  if (lowHp(obs, 0.25) && hasItem(obs, "HEAL")) {
    return { type: "USE", item: "HEAL" };
  }

  // ── GEAR UP: weapon makes every future attack +5 dmg ──────────
  if (canPickup(obs)) return { type: "PICKUP" };
  if (!hasItem(obs, "WEAPON")) {
    const weapon = nearestItem(obs, "WEAPON");
    if (weapon) {
      const d = smartMove(obs, dirTo(weapon.dx, weapon.dy));
      if (d) return { type: "MOVE", dir: d };
    }
  }

  // ── HUNT: chase the WEAKEST visible enemy ─────────────────────
  const enemies = visibleBots(obs);
  if (enemies.length > 0) {
    // Prefer wounded targets — easier kills, more rating points.
    const prey = enemies.reduce((a, b) => (a.hp <= b.hp ? a : b));
    const d = smartMove(obs, dirTo(prey.dx, prey.dy));
    if (d) return { type: "MOVE", dir: d };
  }

  // ── ROAM: head toward the zone where action will happen ──────
  return { type: "MOVE", dir: dirToNextZone(obs) ?? dirToZone(obs) };
}
