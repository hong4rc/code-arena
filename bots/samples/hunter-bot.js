// hunter-bot — stalks the lowest-HP visible enemy.
export default function decide(obs) {
  // 1. Adjacent enemy? Attack.
  for (const dir of DIRS) {
    if (adjacent(obs, dir)?.kind === "bot") {
      return { type: "ATTACK", dir };
    }
  }

  // 2. Find the weakest visible enemy and chase them.
  const enemies = visibleBots(obs);
  if (enemies.length > 0) {
    const prey = enemies.reduce((a, b) => (a.hp <= b.hp ? a : b));
    return { type: "MOVE", dir: dirTo(prey.dx, prey.dy) };
  }

  // 3. No enemies in sight — go grab a weapon if we can find one.
  const weapon = nearestItem(obs, "WEAPON");
  if (weapon) return { type: "MOVE", dir: dirTo(weapon.dx, weapon.dy) };

  return { type: "WAIT" };
}
