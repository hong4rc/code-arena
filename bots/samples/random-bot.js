// random-bot — picks a random action each tick.
export default function decide() {
  const r = Math.random();
  if (r < 0.6) return { type: "MOVE", dir: pickRandom(DIRS) };
  if (r < 0.85) return { type: "ATTACK", dir: pickRandom(DIRS) };
  if (r < 0.95) return { type: "PICKUP" };
  return { type: "WAIT" };
}
