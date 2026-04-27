// random-bot — chaotic. Picks a random action almost every tick.
// Smart-ness: respects the zone (won't suicide outside) and uses HEAL if dying.
// Used as a baseline opponent — every other bot should beat this most of the time.
export default function decide(obs) {
  // Don't bleed out from the zone for free.
  if (!inZone(obs)) return { type: "MOVE", dir: dirToZone(obs) };

  // If we're about to die and we have a heal, take it.
  if (lowHp(obs, 0.25) && hasItem(obs, "HEAL")) {
    return { type: "USE", item: "HEAL" };
  }

  // Otherwise: chaos.
  const r = Math.random();
  if (r < 0.5) return { type: "MOVE", dir: pickRandom(DIRS) };
  if (r < 0.7) return { type: "ATTACK", dir: pickRandom(DIRS) };
  if (r < 0.9) {
    const dx = Math.floor(Math.random() * 21) - 10;
    const dy = Math.floor(Math.random() * 21) - 10;
    return { type: "SHOOT", target: { dx: dx || 1, dy } };
  }
  if (r < 0.95) return { type: "PICKUP" };
  return { type: "WAIT" };
}
