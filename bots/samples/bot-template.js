// Code Arena — Bot Template
//
// You implement `decide(observation, state)`. The platform calls it once per tick.
//
// observation = {
//   tick: 3,                                       // current tick number (0-based)
//   self: { x, y, hp, attack, speed, inventory: ["HEAL"] },
//   view: [[cell, cell, cell, cell, cell],         // 5x5 grid centered on you
//          [...], [...], [...], [...]],            // view[2][2] is your cell
//   tickTimeMs: 300                                // your max wall time per tick
// }
// cell = { kind: "empty" | "wall" | "item" | "bot" | "unknown",
//          item?: "HEAL" | "WEAPON" | "SHIELD" | "SPEED_BOOST",
//          botId?: "...", hp?: 42 }
//
// Return one of:
//   { type: "MOVE",   dir: "UP" | "DOWN" | "LEFT" | "RIGHT" }
//   { type: "ATTACK", dir: "UP" | "DOWN" | "LEFT" | "RIGHT" }
//   { type: "PICKUP" }
//   { type: "USE", item: "HEAL" | "SHIELD" | "SPEED_BOOST" }
//   { type: "WAIT" }
//
// Tips:
//   • You can mutate `state` to remember things across ticks within a match.
//   • Returning invalid actions (e.g. ATTACK with no target) is silently
//     downgraded to WAIT — you won't be penalized, but you won't act either.
//   • Crashes / timeouts / malformed JSON DO count toward your forfeit budget
//     (3 strikes → you sit out the rest of the match).

import { runBot } from "./_sdk.js";

function decide(_observation, _state) {
  return { type: "WAIT" };
}

runBot(decide);
