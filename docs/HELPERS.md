# Bot Helpers Reference

Your bot is **a single file** that default-exports `decide(observation, state)`. The platform calls `decide` once per tick and you return one action.

These helpers are **available as globals** — no `import` needed, just call them.

```js
export default function decide(obs, state) {
  if (lowHp(obs) && hasItem(obs, "HEAL")) return { type: "USE", item: "HEAL" };
  const attack = bestAttackDir(obs);
  if (attack) return { type: "ATTACK", dir: attack };
  if (canPickup(obs)) return { type: "PICKUP" };
  const item = nearestItem(obs);
  if (item) return { type: "MOVE", dir: dirTo(item.dx, item.dy) };
  return { type: "MOVE", dir: safestDir(obs) };
}
```

That's a viable, competitive bot in 8 lines.

---

## Observation shape

```ts
observation = {
  tick: 3,
  self: {
    x, y,                     // position on the full map
    hp, attack, speed,        // your stats
    inventory: ["HEAL", ...]  // items you carry
  },
  view: cell[5][5],           // 5x5 grid centered on you (view[2][2] = you)
  tickTimeMs: 300             // your wall-time budget per tick
}

cell = {
  kind: "empty" | "wall" | "item" | "bot" | "unknown",
  item?:  "HEAL" | "WEAPON" | "SHIELD" | "SPEED_BOOST",
  botId?: string,
  hp?:    number               // visible HP of an enemy bot
}
```

`state` is a per-bot, per-match object. Mutate it freely to remember things across ticks. It's reset at the start of each match.

Cells off the grid show as `{ kind: "wall" }`. Cells outside your 5×5 view simply aren't in `view` — you only see what's around you.

---

## Looking around

### `DIRS`
```js
DIRS  // ["UP", "DOWN", "LEFT", "RIGHT"]
```
Iterate cardinal directions cleanly:
```js
for (const dir of DIRS) {
  if (canAttack(obs, dir)) return { type: "ATTACK", dir };
}
```

---

### `adjacent(obs, dir) → cell | undefined`
The single cell next to you in `dir`. `undefined` if off-grid.
```js
if (adjacent(obs, "UP")?.kind === "item") {
  // there's an item one step up
}
```

---

### `here(obs) → cell`
The cell you're standing on. Useful before `PICKUP`.
```js
if (here(obs).kind === "item") return { type: "PICKUP" };
```

---

### `nearestBot(obs) → { dx, dy, dist, hp, botId } | null`
Closest visible enemy by Manhattan distance.

### `nearestItem(obs, kind?) → { dx, dy, dist, item } | null`
Closest visible item, optionally filtered:
```js
const heal   = nearestItem(obs, "HEAL");
const weapon = nearestItem(obs, "WEAPON");
const any    = nearestItem(obs);          // any kind
```

### `nearest(obs, predicate) → result | null`
General-purpose nearest-cell finder.
```js
const lowHpEnemy = nearest(obs, c => c.kind === "bot" && (c.hp ?? 100) < 30);
```

### `visibleBots(obs) → array`
All visible enemy bots: `[{ dx, dy, dist, hp, botId }, ...]`.
```js
const enemies = visibleBots(obs);
const total = enemies.reduce((s, e) => s + (e.hp ?? 100), 0);
log("total enemy hp:", total);
```

### `visibleItems(obs, kind?) → array`
All visible items.

### `adjacentBots(obs) → array`
Enemies in any of the 4 immediately-adjacent cells: `[{ dir, dx, dy, hp, botId }, ...]`.
Empty array if nobody is touching you.

### `adjacentItems(obs) → array`
Items in any adjacent cell.

---

## Action checks (fail fast, never WAIT silently)

The engine forgives illegal actions (downgrades them to WAIT), but a wasted tick is still a wasted tick. Check before acting.

### `canMove(obs, dir) → boolean`
True if that adjacent cell is empty or has an item (you can step there). False for walls and bots.

### `canAttack(obs, dir) → cell | null`
The target cell if there's an enemy in attack range, else `null`. **Knows about WEAPON range automatically** (range 2 if you hold a WEAPON, range 1 otherwise).
```js
if (canAttack(obs, "RIGHT")) return { type: "ATTACK", dir: "RIGHT" };
```

### `canKill(obs, dir) → cell | null`
The target if a single attack would drop them to 0 HP. Approximate (ignores SHIELD on the target, since you can't see opponent inventory). Useful for prioritising finishing blows.

### `canPickup(obs) → boolean`
True if you're standing on an item.

### `attackRange(obs) → 1 | 2`
Your effective melee range — 2 with WEAPON, 1 otherwise.

### `bestAttackDir(obs) → "UP" | "DOWN" | "LEFT" | "RIGHT" | null`
The single best attack you have right now:
1. A direction that scores a kill, if any.
2. Otherwise, the lowest-HP target in range.
3. Otherwise `null`.

```js
const dir = bestAttackDir(obs);
if (dir) return { type: "ATTACK", dir };
```

---

## Inventory & HP

### `hasItem(obs, kind) → boolean`
```js
if (hasItem(obs, "SHIELD")) return { type: "USE", item: "SHIELD" };
```

### `hpFraction(obs, maxHp = 100) → 0..1`

### `lowHp(obs, ratio = 0.5) → boolean`
Convenience for heal triggers. Default threshold is 50%.
```js
if (lowHp(obs, 0.3) && hasItem(obs, "HEAL")) return { type: "USE", item: "HEAL" };
```

---

## Movement

### `dirTo(dx, dy) → "UP" | "DOWN" | "LEFT" | "RIGHT"`
Best one-step direction toward an offset. Picks the dominant axis (largest absolute component); ties favour horizontal.

### `fleeFrom(dx, dy) → direction`
Opposite of `dirTo`. `fleeFrom(2, 0)` returns `"LEFT"`.

### `opposite(dir) → direction`
`opposite("UP") === "DOWN"`. Useful for "step away from threat":
```js
const threat = adjacentBots(obs)[0];
if (threat) return { type: "MOVE", dir: opposite(threat.dir) };
```

### `safestDir(obs) → direction`
Direction with the fewest visible enemies, biased toward cells you can actually move into. Good default for "I have nothing better to do".

### `smartMove(obs, dir) → direction | null`
Returns `dir` if you can step that way, otherwise tries a perpendicular fallback (so a single wall doesn't stall you). Returns `null` if everything is blocked.
```js
const target = nearestItem(obs);
if (target) {
  const d = smartMove(obs, dirTo(target.dx, target.dy));
  if (d) return { type: "MOVE", dir: d };
}
```

### `turn(dir, n = 1) → direction`
Rotate `n` quarter-turns clockwise (negative `n` is counter-clockwise).
```js
turn("UP")     // "RIGHT"
turn("UP", 2)  // "DOWN"
turn("UP", -1) // "LEFT"
```
Useful for wall-following or scanning patterns.

---

## Misc

### `dist(dx, dy) → number`  /  `dist({dx, dy}) → number`
Manhattan distance. Both call styles work — handy after destructuring a result:
```js
const item = nearestItem(obs);
log("item dist:", dist(item));  // dist(item.dx, item.dy) also fine
```

### `scanLine(obs, dir, range?) → array`
Cells in a straight line away from you, stopping at the first wall.
`range` defaults to your vision radius (2 in a 5×5 view).
```js
const lineRight = scanLine(obs, "RIGHT");
// → [{ step: 1, kind: "empty" }, { step: 2, kind: "bot", hp: 35 }]
const enemyAhead = lineRight.find(c => c.kind === "bot");
```

### `pickRandom(arr) → element`
```js
return { type: "MOVE", dir: pickRandom(DIRS) };
```

### `log(...args) → void`
Write a debug line to your bot's stderr. **Only YOU see this** in your bot's match logs — it's not visible to opponents and doesn't affect the protocol. Objects are auto-stringified.
```js
log("tick", obs.tick, "hp", obs.self.hp, "inv", obs.self.inventory);
log({ enemies: visibleBots(obs).length });
```

---

## Patterns / recipes

### 1. Glass cannon — kill or get killed
```js
export default function decide(obs) {
  const dir = bestAttackDir(obs);
  if (dir) return { type: "ATTACK", dir };
  const enemy = nearestBot(obs);
  if (enemy) return { type: "MOVE", dir: dirTo(enemy.dx, enemy.dy) };
  return { type: "WAIT" };
}
```

### 2. Survivor — heal, shield, run
```js
export default function decide(obs) {
  if (lowHp(obs, 0.3) && hasItem(obs, "HEAL")) return { type: "USE", item: "HEAL" };
  if (adjacentBots(obs).length > 0 && hasItem(obs, "SHIELD")) return { type: "USE", item: "SHIELD" };
  if (adjacentBots(obs).length > 0) return { type: "MOVE", dir: safestDir(obs) };
  if (canPickup(obs)) return { type: "PICKUP" };
  const heal = nearestItem(obs, "HEAL");
  if (heal) return { type: "MOVE", dir: smartMove(obs, dirTo(heal.dx, heal.dy)) ?? safestDir(obs) };
  return { type: "MOVE", dir: safestDir(obs) };
}
```

### 3. Opportunist — only fight when winning
```js
export default function decide(obs) {
  const kill = DIRS.find(d => canKill(obs, d));
  if (kill) return { type: "ATTACK", dir: kill };
  if (canPickup(obs)) return { type: "PICKUP" };
  const weapon = nearestItem(obs, "WEAPON");
  if (weapon && !hasItem(obs, "WEAPON")) {
    const d = smartMove(obs, dirTo(weapon.dx, weapon.dy));
    if (d) return { type: "MOVE", dir: d };
  }
  return { type: "MOVE", dir: safestDir(obs) };
}
```

### 4. Memory — chase your last target
```js
export default function decide(obs, state) {
  // Lock onto a target across ticks.
  if (!state.targetId || !visibleBots(obs).some(b => b.botId === state.targetId)) {
    const e = nearestBot(obs);
    state.targetId = e?.botId ?? null;
  }
  const target = visibleBots(obs).find(b => b.botId === state.targetId);
  if (target) {
    const d = smartMove(obs, dirTo(target.dx, target.dy));
    if (canAttack(obs, dirTo(target.dx, target.dy))) {
      return { type: "ATTACK", dir: dirTo(target.dx, target.dy) };
    }
    if (d) return { type: "MOVE", dir: d };
  }
  return { type: "MOVE", dir: safestDir(obs) };
}
```

---

## What's NOT exposed (and why)

- **Network / fs / process / require / eval / Function / dynamic import()** — all rejected at upload time. Bots are pure functions of `(obs, state)`.
- **Other bots' inventory / strikes / damage dealt** — fog of war means you only see HP of visible enemies. You never see what they're carrying.
- **Game balance constants** (HP cap, item stats, attack bonus) — these can change per season. Use `obs.self.attack` for your current attack value rather than hard-coding 10.
- **Pathfinding across the full map** — your view is 5×5. Plan within that. `state` is fine for remembering where things were.

---

## Action contract — return values

```js
{ type: "MOVE",   dir: "UP" | "DOWN" | "LEFT" | "RIGHT" }
{ type: "ATTACK", dir: "UP" | "DOWN" | "LEFT" | "RIGHT" }
{ type: "PICKUP" }
{ type: "USE", item: "HEAL" | "SHIELD" | "SPEED_BOOST" }
{ type: "WAIT" }
```

- **Illegal action** (ATTACK with no target, MOVE into a wall, USE without the item, …) → silently downgraded to WAIT. **No HP penalty.** The replay logs the attempted action and reason.
- **Protocol error** (timeout > 300 ms, crash, malformed JSON, returned `undefined`) → counted as a strike. **3 strikes → forfeit.**
- **Returning nothing** counts as a malformed action. Always return something.

---

## Forbidden patterns (rejected at upload)

- Any `import` statement.
- `eval()`, `new Function(...)`, dynamic `import()`.
- References to `process`, `Bun`, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `require`.

You'll see the rejection in the editor immediately when you click **Save**. Fix the highlighted line and save again.
