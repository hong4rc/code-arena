// Code Arena — Bot Template
//
// Edit the body of `decide`. That's the whole bot.
//
// observation = {
//   tick: 3,
//   self: { x, y, hp, attack, speed, inventory: ["HEAL"] },
//   view: 5x5 array of cells around you (you are at the center),
//   tickTimeMs: 300
// }
//
// cell = { kind: "empty" | "wall" | "item" | "bot" | "unknown",
//          item?: "HEAL" | "WEAPON" | "SHIELD" | "SPEED_BOOST",
//          botId?: "...", hp?: 42 }
//
// Return ONE of:
//   { type: "MOVE",   dir: "UP" | "DOWN" | "LEFT" | "RIGHT" }
//   { type: "ATTACK", dir: "UP" | "DOWN" | "LEFT" | "RIGHT" }
//   { type: "PICKUP" }
//   { type: "USE", item: "HEAL" | "SHIELD" | "SPEED_BOOST" }
//   { type: "WAIT" }
//
// Helpers available as globals (no import needed):
//   DIRS                     — ["UP","DOWN","LEFT","RIGHT"]
//   adjacent(obs, dir)       — the cell next to you in `dir` (or undefined off-grid)
//   here(obs)                — the cell you're standing on
//   nearestBot(obs)          — { dx, dy, dist, hp, botId } or null
//   nearestItem(obs, kind?)  — { dx, dy, dist, item } or null
//   dirTo(dx, dy)            — best direction to step toward (dx, dy)
//   fleeFrom(dx, dy)         — opposite of dirTo (run away)
//   pickRandom(arr)          — random element
//
// Tip: invalid actions (e.g. ATTACK with no target) are treated as WAIT — no
// HP penalty. Crashes / timeouts DO count toward your forfeit budget (3 strikes).

export default function decide(_observation, _state) {
  return { type: "WAIT" };
}
