// random-bot — picks a random valid-looking action each tick.
import { runBot, DIRS, pickRandom } from "./_sdk.js";

function decide(_observation, _state) {
  const roll = Math.random();
  if (roll < 0.6) return { type: "MOVE", dir: pickRandom(DIRS) };
  if (roll < 0.85) return { type: "ATTACK", dir: pickRandom(DIRS) };
  if (roll < 0.95) return { type: "PICKUP" };
  return { type: "WAIT" };
}

runBot(decide);
