// defensive-bot — TURTLE. Main objective: stay alive at any cost.
// Heals proactively, shields aggressively, ALWAYS retreats from threats.
// Wins by outlasting more reckless bots — never by killing them.
export default function decide(obs, state) {
  state.lastShieldTick ??= -100;
  const velocity = trackEnemies(obs, state);

  // ── ZONE: NEVER take zone damage ──────────────────────────────
  if (!inZone(obs)) return { type: "MOVE", dir: dirToZone(obs) };
  // Be EARLY about repositioning — defensive bot wants margin.
  const tts = ticksUntilShrink(obs);
  if (tts !== null && tts <= 40 && !inNextZone(obs)) {
    const d = dirToNextZone(obs);
    if (d) return { type: "MOVE", dir: d };
  }

  // ── HP MANAGEMENT: keep ourselves topped up ──────────────────
  // Heal more aggressively than other bots — at 60% not 30%.
  if (lowHp(obs, 0.6) && hasItem(obs, "HEAL")) {
    return { type: "USE", item: "HEAL" };
  }

  // ── SHIELD: pop it any time someone's close or shooting at us ─
  const incoming = incomingBullets(obs);
  const threats = adjacentBots(obs);
  const visible = visibleBots(obs);
  const shieldCooldownOk = obs.tick - state.lastShieldTick > 20;
  if (hasItem(obs, "SHIELD") && shieldCooldownOk
      && (threats.length > 0 || incoming.length > 0
          || visible.some((b) => b.dist <= 4))) {
    state.lastShieldTick = obs.tick;
    return { type: "USE", item: "SHIELD" };
  }

  // ── DODGE: bullets first ───────────────────────────────────────
  if (incoming.length > 0) {
    const b = incoming[0];
    const horizontal = Math.abs(b.vx) >= Math.abs(b.vy);
    // Prefer the dodge direction that takes us TOWARD the zone center.
    const choices = horizontal ? ["UP", "DOWN"] : ["LEFT", "RIGHT"];
    const homeDir = dirToZone(obs);
    const ordered = choices.includes(homeDir)
      ? [homeDir, ...choices.filter((d) => d !== homeDir)]
      : choices;
    for (const d of ordered) if (canMove(obs, d)) return { type: "MOVE", dir: d };
  }

  // ── RETREAT: never stand next to an enemy ─────────────────────
  if (threats.length > 0) {
    const away = opposite(threats[0].dir);
    if (canMove(obs, away)) return { type: "MOVE", dir: away };
    // If the obvious retreat is blocked, take any safe direction.
    return { type: "MOVE", dir: safestDir(obs) };
  }

  // ── KEEP DISTANCE + COVERING FIRE ─────────────────────────────
  // Free shot at anyone in line — discourage pursuers.
  if (canShoot(obs)) {
    const closest = visible.find((b) => b.dist <= 7);
    if (closest) return { type: "SHOOT", target: leadShot(obs, closest, velocity[closest.botId], { bulletSpeed: 5 }) };
  }
  // Anyone within ~5 cells = too close. Run away.
  const closest = visible.find((b) => b.dist <= 5);
  if (closest) {
    const d = smartMove(obs, fleeFrom(closest.dx, closest.dy));
    if (d) return { type: "MOVE", dir: d };
  }

  // ── LOOT: stack up survival items ─────────────────────────────
  if (canPickup(obs)) return { type: "PICKUP" };
  for (const kind of ["HEAL", "SHIELD", "WEAPON"]) {
    if (!hasItem(obs, kind)) {
      const it = nearestItem(obs, kind);
      if (it) {
        const d = smartMove(obs, dirTo(it.dx, it.dy));
        if (d) return { type: "MOVE", dir: d };
      }
    }
  }

  // ── DEFAULT: drift toward safety, stay near zone center ──────
  return { type: "MOVE", dir: dirToNextZone(obs) ?? dirToZone(obs) ?? safestDir(obs) };
}
