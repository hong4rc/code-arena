// survivor-bot — TACTICIAN. Main objective: be the last one standing.
// Adapts behavior to game state: loots early, fights mid-game, gets aggressive
// when only 1-2 enemies remain. Uses the full toolkit at the right time.
export default function decide(obs, state) {
  state.lastHealTick ??= -100;
  const velocity = trackEnemies(obs, state);

  const enemies = visibleBots(obs);
  const endgame = isEndgame(obs); // global roster knows survivors even when none visible
  const isLate = obs.tick > 600;          // ~60s in: stop being patient

  // ── ZONE: don't bleed unnecessarily ───────────────────────────
  if (!inZone(obs)) return { type: "MOVE", dir: dirToZone(obs) };
  const tts = ticksUntilShrink(obs);
  if (tts !== null && tts <= 30 && !inNextZone(obs)) {
    const d = dirToNextZone(obs);
    if (d) return { type: "MOVE", dir: d };
  }

  // ── HP MANAGEMENT (smart timing) ──────────────────────────────
  // Don't heal in panic — only when actually low. But never refuse a heal we'll lose.
  const healThreshold = endgame ? 0.4 : 0.35;
  if (lowHp(obs, healThreshold) && hasItem(obs, "HEAL")
      && obs.tick - state.lastHealTick > 5) {
    state.lastHealTick = obs.tick;
    return { type: "USE", item: "HEAL" };
  }

  // ── SHIELD: pop on multiple threats ───────────────────────────
  const incoming = incomingBullets(obs);
  const threats = adjacentBots(obs);
  const realDanger = threats.length > 0
    || incoming.length > 0
    || enemies.some((e) => e.dist <= 3);
  if (realDanger && hasItem(obs, "SHIELD")) {
    return { type: "USE", item: "SHIELD" };
  }

  // ── DODGE bullets perpendicular ───────────────────────────────
  if (incoming.length > 0) {
    const b = incoming[0];
    const horizontal = Math.abs(b.vx) >= Math.abs(b.vy);
    const choices = horizontal ? ["UP", "DOWN"] : ["LEFT", "RIGHT"];
    for (const d of choices) if (canMove(obs, d)) return { type: "MOVE", dir: d };
  }

  // ── COMBAT (always take a kill) ───────────────────────────────
  for (const dir of DIRS) {
    if (canKill(obs, dir)) return { type: "ATTACK", dir };
  }
  for (const dir of DIRS) {
    if (canAttack(obs, dir)) return { type: "ATTACK", dir };
  }
  if (canShoot(obs) && enemies.length > 0) {
    const t = enemies.reduce((a, b) => (a.hp <= b.hp ? a : b));
    return { type: "SHOOT", target: leadShot(obs, t, velocity[t.botId], { bulletSpeed: 5 }) };
  }

  // ── LOOT: only worth detouring when not being shot at ────────
  if (canPickup(obs)) return { type: "PICKUP" };
  // Early/mid game: prioritise gear. Endgame: skip loot, push fights.
  if (!endgame && !isLate) {
    const want = [];
    if (lowHp(obs, 0.7)) want.push("HEAL");
    if (!hasItem(obs, "WEAPON")) want.push("WEAPON");
    if (!hasItem(obs, "SHIELD")) want.push("SHIELD");
    for (const kind of want) {
      const it = nearestItem(obs, kind);
      if (it && it.dist <= 8) {
        const d = smartMove(obs, dirTo(it.dx, it.dy));
        if (d) return { type: "MOVE", dir: d };
      }
    }
  }

  // ── HUNT (push harder in endgame) ────────────────────────────
  if (enemies.length > 0) {
    // Endgame: chase even high-HP targets. Mid game: pick the weakest.
    const prey = endgame
      ? enemies.reduce((a, b) => (a.dist <= b.dist ? a : b))   // closest
      : enemies.reduce((a, b) => (a.hp <= b.hp ? a : b));      // weakest
    const d = smartMove(obs, dirTo(prey.dx, prey.dy));
    if (d) return { type: "MOVE", dir: d };
  }

  // ── ROAM: drift toward where the action will be ─────────────
  return { type: "MOVE", dir: dirToNextZone(obs) ?? dirToZone(obs) ?? safestDir(obs) };
}
