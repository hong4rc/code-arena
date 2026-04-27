// Code Arena — Bot Template
//
// Edit the body of `decide`. That's the whole bot.
//
// observation = {
//   tick: 3,
//   self: { x, y, hp, attack, speed, inventory: ["HEAL"] },
//   view: 5x5 array of cells (you are at the center, view[2][2]),
//   tickTimeMs: 300
// }
// cell = { kind: "empty"|"wall"|"item"|"bot"|"unknown",
//          item?: "HEAL"|"WEAPON"|"SHIELD"|"SPEED_BOOST",
//          botId?: "...", hp?: 42 }
//
// Return ONE of:
//   { type: "MOVE",   dir: "UP"|"DOWN"|"LEFT"|"RIGHT" }
//   { type: "ATTACK", dir: "UP"|"DOWN"|"LEFT"|"RIGHT" }
//   { type: "PICKUP" }
//   { type: "USE", item: "HEAL"|"SHIELD"|"SPEED_BOOST" }
//   { type: "WAIT" }
//
// ── Helpers (no import — call them directly) ──────────────────────────
//
// Looking around:
//   DIRS                       ["UP","DOWN","LEFT","RIGHT"]
//   adjacent(obs, dir)         cell next to you in `dir` (or undefined off-grid)
//   here(obs)                  cell you're standing on
//   nearestBot(obs)            { dx, dy, dist, hp, botId } | null
//   nearestItem(obs, kind?)    { dx, dy, dist, item }      | null
//   nearest(obs, predicate)    nearest cell matching predicate, or null
//   visibleBots(obs)           array of all visible enemy bots
//   visibleItems(obs, kind?)   array of all visible items
//   adjacentBots(obs)          enemies in the 4 cells next to you: [{dir,...}]
//   adjacentItems(obs)         items in the 4 cells next to you
//
// Action checks:
//   canMove(obs, dir)          true if you can step that way (empty cell)
//   canAttack(obs, dir)        target cell if an enemy is in range, else null
//                              (knows about WEAPON range automatically)
//   canPickup(obs)             true if you're standing on an item
//   attackRange(obs)           1, or 2 if you hold a WEAPON
//
// Inventory / HP:
//   hasItem(obs, kind)         true if you carry that item
//   hpFraction(obs)            self.hp / 100
//   lowHp(obs, ratio = 0.5)    true if hp fraction < ratio
//
// Movement:
//   dirTo(dx, dy)              best direction toward (dx, dy)
//   fleeFrom(dx, dy)           opposite of dirTo
//   opposite(dir)              "UP" → "DOWN", etc.
//   safestDir(obs)             direction with fewest visible enemies
//
// Misc:
//   dist(dx, dy)               Manhattan distance
//   pickRandom(arr)            random element of an array
//   log(...args)               write to stderr — only YOU see this in match logs
//
// ── Tips ──────────────────────────────────────────────────────────────
// • Invalid actions (e.g. ATTACK with no target) are treated as WAIT — no
//   HP penalty. Crashes / timeouts / malformed JSON DO count toward your
//   forfeit budget (3 strikes → you sit out the rest of the match).
// • `state` persists across ticks within ONE match. Use it to remember things.

export default function decide(_obs, _state) {
  // Example skeleton you can build on:
  //
  //   if (lowHp(obs) && hasItem(obs, "HEAL")) return { type: "USE", item: "HEAL" };
  //   for (const dir of DIRS) {
  //     if (canAttack(obs, dir)) return { type: "ATTACK", dir };
  //   }
  //   if (canPickup(obs)) return { type: "PICKUP" };
  //   const item = nearestItem(obs);
  //   if (item) return { type: "MOVE", dir: dirTo(item.dx, item.dy) };
  //   return { type: "MOVE", dir: safestDir(obs) };

  return { type: "WAIT" };
}
