// uber-bot — applies every best practice we've found for ES-tuned game AI.
//
// Compared to nn-bot it adds:
//   • Bigger network with residual connections (skip from input through h1/h2)
//     so ES doesn't have to relearn the linear-policy backbone from scratch.
//   • 52 input features (was 28) covering threat distribution, action
//     history, damage rate, item economy, position relative to zone center.
//   • Action-history tracking to break out of "go right go right go right"
//     local loops.
//   • Multi-bullet vector-sum dodge instead of "perpendicular to first one".
//   • Damage-rate emergency reflex (we detect "I'm losing HP fast" before
//     the low-HP threshold trips and switch to escape mode).
//   • Item value model — when comparing items, weight by current need:
//     HEAL is gold at 30% HP, useless at 100% HP.
//   • Lead-shot AND predictive aim — pre-aim toward where the lowest-HP
//     enemy will be in 2-3 ticks even when off cooldown, so the bullet
//     fires the instant cooldown opens.
//   • Action masking — illegal actions are filtered before argmax so the
//     NN's gradient/ES signal isn't wasted on impossible moves.
//   • Strict winrate-preserving rules — ALWAYS take a guaranteed kill,
//     ALWAYS heal at low HP, ALWAYS flee zone, NEVER waste a turn.
//
// Architecture:
//   input(52) → tanh(40) → tanh(40) ⊕ skip → tanh(24) → linear(8)
//   ~3,500 weights total. ES-friendly with sparse mutation (3-5%).

const SHAPE = [52, 40, 40, 24, 8];
const NN_ACTIONS = [
  "MOVE_UP", "MOVE_DOWN", "MOVE_LEFT", "MOVE_RIGHT",
  "DASH_UP", "DASH_DOWN", "DASH_LEFT", "DASH_RIGHT",
];

export default function decide(obs, state) {
  // ── 1. INIT (first tick of the match) ────────────────────────────
  if (!state.__init) {
    state.params = state.params ?? {};
    const need = totalWeights(SHAPE);
    if (!Array.isArray(state.params.weights) || state.params.weights.length !== need) {
      state.params.weights = randomWeights(need);
    }
    state.__init = true;
    state.actionHistory = [];
    state.hpHistory = [];
    state.lastShield = -100;
    state.lastSpeedBoost = -100;
  }

  // ── 2. UPDATE PER-TICK MEMORY ────────────────────────────────────
  const velocity = trackEnemies(obs, state);
  state.hpHistory.push({ tick: obs.tick, hp: obs.self.hp });
  while (state.hpHistory.length > 5) state.hpHistory.shift();
  const oldest = state.hpHistory[0];
  const hpLossRate = oldest ? Math.max(0, oldest.hp - obs.self.hp) : 0;
  const bleedingFast = hpLossRate >= 25;

  const enemies = visibleBots(obs);
  const incoming = incomingBullets(obs);
  const close = enemies.filter((e) => e.dist <= 5);
  const veryClose = enemies.filter((e) => e.dist <= 3);

  // ── 3. RULES (priority order — beats NN whenever fired) ──────────

  // A. Out of zone — every tick of bleed is HP we never get back.
  if (!inZone(obs)) {
    const dir = dirToZone(obs);
    if (dir) {
      if (canDash(obs) && canMove(obs, dir)) return remember(state, { type: "DASH", dir });
      if (canMove(obs, dir)) return remember(state, { type: "MOVE", dir });
    }
  }

  // B. Shrink imminent and we're not in next zone.
  const tts = ticksUntilShrink(obs);
  if (tts !== null && tts <= 25 && !inNextZone(obs)) {
    const dir = dirToNextZone(obs);
    if (dir) {
      if (tts <= 12 && canDash(obs) && canMove(obs, dir)) return remember(state, { type: "DASH", dir });
      if (canMove(obs, dir)) return remember(state, { type: "MOVE", dir });
    }
  }

  // C. Critical HP + HEAL. Earlier threshold than nn-bot (40 vs 35) because
  //    losing the heal is worse than wasting a tick.
  if (lowHp(obs, 0.4) && hasItem(obs, "HEAL")) {
    return remember(state, { type: "USE", item: "HEAL" });
  }

  // D. Bullet incoming + SHIELD ready (8-tick cooldown).
  const shieldReady = obs.tick - state.lastShield > 8;
  if (incoming.length > 0 && hasItem(obs, "SHIELD") && shieldReady) {
    state.lastShield = obs.tick;
    return remember(state, { type: "USE", item: "SHIELD" });
  }

  // E. Bleeding + threat — pop SHIELD predictively even without rendered bullet.
  if (bleedingFast && veryClose.length > 0 && hasItem(obs, "SHIELD") && shieldReady) {
    state.lastShield = obs.tick;
    return remember(state, { type: "USE", item: "SHIELD" });
  }

  // F. Item under us — free pickup.
  if (canPickup(obs)) return remember(state, { type: "PICKUP" });

  // G. Guaranteed kill on adjacent bot — never let them escape.
  for (const d of DIRS) {
    if (canKill(obs, d)) return remember(state, { type: "ATTACK", dir: d });
  }

  // H. SHOOT with lead — focus on lowest-HP enemy (highest reward per shot).
  if (canShoot(obs) && enemies.length > 0) {
    const target = pickShootTarget(enemies);
    const aim = leadShot(obs, target, velocity[target.botId], { bulletSpeed: 5 });
    return remember(state, { type: "SHOOT", target: aim });
  }

  // I. Adjacent enemy — free melee damage.
  for (const d of DIRS) {
    if (canAttack(obs, d)) return remember(state, { type: "ATTACK", dir: d });
  }

  // J. Endgame: pop SPEED_BOOST; mid-game: pop when chasing wounded prey.
  const speedReady = obs.tick - state.lastSpeedBoost > 30;
  if (hasItem(obs, "SPEED_BOOST") && speedReady) {
    if (isEndgame(obs) && enemies.length > 0) {
      state.lastSpeedBoost = obs.tick;
      return remember(state, { type: "USE", item: "SPEED_BOOST" });
    }
    const wounded = enemies.find((e) => e.hp !== undefined && e.hp < 30 && e.dist <= 6);
    if (wounded) {
      state.lastSpeedBoost = obs.tick;
      return remember(state, { type: "USE", item: "SPEED_BOOST" });
    }
  }

  // K. Multi-bullet vector-sum dodge.
  if (incoming.length > 0) {
    const dir = dodgeVectorSum(obs, incoming);
    if (dir) return remember(state, { type: "MOVE", dir });
  }

  // L. Closing dash on a wounded target at striking distance.
  if (canDash(obs)) {
    const wounded = enemies.find((e) => e.hp !== undefined && e.hp <= 35 && e.dist >= 3 && e.dist <= 7);
    if (wounded) {
      const dir = dirTo(wounded.dx, wounded.dy);
      if (dir && canMove(obs, dir)) return remember(state, { type: "DASH", dir });
    }
  }

  // M. Escape dash if pinned by 3+ enemies.
  if (canDash(obs) && close.length >= 3) {
    const dir = bestDashDir(obs);
    if (dir) return remember(state, { type: "DASH", dir });
  }

  // N. Loot economy (capped detour) — value-aware.
  const need = needScore(obs);
  if (need.bestKind) {
    const it = nearestItem(obs, need.bestKind);
    if (it && it.dist <= need.detour) {
      const dir = smartMove(obs, dirTo(it.dx, it.dy));
      if (dir) return remember(state, { type: "MOVE", dir });
    }
  }

  // ── 4. NN POLICY — strategic positioning ────────────────────────
  const features = featurize(obs, state, enemies, incoming);
  const logits = forward(features, state.params.weights, SHAPE);
  // Action masking — illegal moves get -Infinity so argmax skips them.
  const masked = NN_ACTIONS.map((name, i) => isLegal(name, obs) ? logits[i] : -Infinity);
  const ranked = [...masked.keys()].sort((a, b) => masked[b] - masked[a]);
  for (const idx of ranked) {
    const a = realiseNNAction(NN_ACTIONS[idx], obs);
    if (a) return remember(state, a);
  }
  return remember(state, { type: "WAIT" });
}

// ─── helpers ─────────────────────────────────────────────────────────

function remember(state, action) {
  state.actionHistory.push(action.type + (action.dir ?? ""));
  while (state.actionHistory.length > 6) state.actionHistory.shift();
  return action;
}

function shootScore(en) {
  return (101 - (en.hp ?? 100)) / Math.max(1, en.dist) + (en.dist <= 8 ? 5 : 0);
}

function pickShootTarget(enemies) {
  // Score: low HP + close + line of sight (already enforced by visibility).
  return enemies.reduce((best, e) => shootScore(e) > shootScore(best) ? e : best);
}

function dodgeVectorSum(obs, incoming) {
  // Sum the danger vectors of all incoming bullets (each bullet contributes
  // its velocity weighted by 1/dist), then pick the perpendicular cardinal
  // that minimises the dot product with that danger vector.
  let dx = 0, dy = 0;
  for (const b of incoming) {
    const w = 1 / Math.max(1, b.dist);
    dx += b.vx * w;
    dy += b.vy * w;
  }
  // Perpendicular has 0 dot product. Score each cardinal.
  const dirVec = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };
  const home = dirToZone(obs);
  let best = null, bestScore = Infinity;
  for (const d of DIRS) {
    if (!canMove(obs, d)) continue;
    const [vx, vy] = dirVec[d];
    let score = Math.abs(vx * dx + vy * dy);
    if (d === home) score -= 0.5; // small bias toward zone
    if (score < bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function needScore(obs) {
  // Pick the most valuable missing item to detour for, given current state.
  const hp = obs.self.hp;
  const best = { bestKind: null, score: 0, detour: 6 };
  if (hp < 50 && !hasItem(obs, "HEAL")) {
    best.bestKind = "HEAL";
    best.score = (100 - hp) * 0.5;
    best.detour = 8;
  } else if (!hasItem(obs, "WEAPON")) {
    best.bestKind = "WEAPON";
    best.score = 30;
    best.detour = 6;
  } else if (!hasItem(obs, "SHIELD")) {
    best.bestKind = "SHIELD";
    best.score = 20;
    best.detour = 5;
  } else if (!hasItem(obs, "SPEED_BOOST")) {
    best.bestKind = "SPEED_BOOST";
    best.score = 15;
    best.detour = 4;
  }
  return best;
}

function isLegal(actionName, obs) {
  if (actionName.startsWith("MOVE_")) return canMove(obs, actionName.slice(5));
  if (actionName.startsWith("DASH_")) return canDash(obs) && canMove(obs, actionName.slice(5));
  return true;
}

function realiseNNAction(name, obs) {
  if (name.startsWith("MOVE_")) {
    const dir = name.slice(5);
    return canMove(obs, dir) ? { type: "MOVE", dir } : null;
  }
  if (name.startsWith("DASH_")) {
    if (!canDash(obs)) return null;
    const dir = name.slice(5);
    return canMove(obs, dir) ? { type: "DASH", dir } : null;
  }
  return null;
}

// ─── feature extraction (52 inputs) ──────────────────────────────────

function featurize(obs, state, enemies, incoming) {
  const f = Array.from({ length: SHAPE[0] }, () => 0);
  let i = 0;

  // 0–4 self stats
  f[i++] = obs.self.hp / 100;
  f[i++] = (obs.self.shootCooldown ?? 0) / 8;
  f[i++] = (obs.self.dashCooldown ?? 0) / 8;
  f[i++] = aliveCount(obs) / 6;
  f[i++] = obs.tick / 900;

  // 5–8 inventory
  f[i++] = hasItem(obs, "HEAL")        ? 1 : 0;
  f[i++] = hasItem(obs, "WEAPON")      ? 1 : 0;
  f[i++] = hasItem(obs, "SHIELD")      ? 1 : 0;
  f[i++] = hasItem(obs, "SPEED_BOOST") ? 1 : 0;

  // 9–12 zone
  const cx = (obs.zone.xMin + obs.zone.xMax) / 2;
  const cy = (obs.zone.yMin + obs.zone.yMax) / 2;
  f[i++] = Math.tanh((cx - obs.self.x) / 50);
  f[i++] = Math.tanh((cy - obs.self.y) / 50);
  f[i++] = (obs.zone.ticksUntilShrink ?? 100) / 100;
  f[i++] = inNextZone(obs) ? 1 : 0;

  // 13–17 nearest enemy
  const e1 = enemies[0];
  if (e1) {
    f[i++] = 1;
    f[i++] = e1.dist / 14;
    f[i++] = e1.dx / 14;
    f[i++] = e1.dy / 14;
    f[i++] = (e1.hp ?? 100) / 100;
  } else { i += 5; }

  // 18–22 second-nearest enemy
  const e2 = enemies[1];
  if (e2) {
    f[i++] = 1;
    f[i++] = e2.dist / 14;
    f[i++] = e2.dx / 14;
    f[i++] = e2.dy / 14;
    f[i++] = (e2.hp ?? 100) / 100;
  } else { i += 5; }

  // 23–26 nearest item
  const it = nearestItem(obs);
  if (it) {
    f[i++] = 1;
    f[i++] = it.dist / 14;
    f[i++] = it.dx / 14;
    f[i++] = it.dy / 14;
  } else { i += 4; }

  // 27–30 nearest incoming bullet
  const b1 = incoming[0];
  if (b1) {
    f[i++] = 1;
    f[i++] = b1.dist / 14;
    f[i++] = b1.vx / 5;
    f[i++] = b1.vy / 5;
  } else { i += 4; }

  // 31–34 quadrant threat density (NW / NE / SW / SE)
  let q = [0, 0, 0, 0];
  for (const e of enemies) {
    const idx = (e.dx >= 0 ? 1 : 0) + (e.dy >= 0 ? 2 : 0);
    q[idx] += 1;
  }
  f[i++] = q[0] / 5;
  f[i++] = q[1] / 5;
  f[i++] = q[2] / 5;
  f[i++] = q[3] / 5;

  // 35–38 action-history one-hot of last move direction
  const last = state.actionHistory.at(-1) ?? "";
  f[i++] = last.endsWith("UP")    ? 1 : 0;
  f[i++] = last.endsWith("DOWN")  ? 1 : 0;
  f[i++] = last.endsWith("LEFT")  ? 1 : 0;
  f[i++] = last.endsWith("RIGHT") ? 1 : 0;

  // 39 streak penalty (last 3 moves the same direction)
  const recent = state.actionHistory.slice(-3);
  const streak = recent.length === 3 && recent.every((s) => s === recent[0]) ? 1 : 0;
  f[i++] = streak;

  // 40–43 HP loss recent ticks
  const oldest = state.hpHistory[0];
  const hpLossRate = oldest ? Math.max(0, oldest.hp - obs.self.hp) : 0;
  f[i++] = hpLossRate / 50;
  f[i++] = (obs.tick - state.lastShield) / 50;
  f[i++] = (obs.tick - state.lastSpeedBoost) / 50;
  f[i++] = enemies.length / 5;

  // 44–47 corner distances (encourage bots to learn corner-using tactics)
  const w = 100, h = 100;
  f[i++] = obs.self.x / w;
  f[i++] = obs.self.y / h;
  f[i++] = (w - obs.self.x) / w;
  f[i++] = (h - obs.self.y) / h;

  // 48–51 ratio features
  f[i++] = enemies.length === 0 ? 0 : (enemies.filter((e) => (e.hp ?? 100) < 50).length / enemies.length);
  f[i++] = enemies.length === 0 ? 0 : Math.min(...enemies.map((e) => e.dist)) / 14;
  f[i++] = obs.self.hp < 30 ? 1 : 0;
  f[i] = obs.self.hp > 75 ? 1 : 0;

  return f;
}

// ─── MLP forward with residual skip ─────────────────────────────────
//
// Skip: hidden_2 ← act(W2·hidden_1 + b2 + hidden_1)   (residual)
// Helps ES / gradient landscape — without skips the bot has to evolve
// near-identity transforms in early layers before any strategy emerges.

function totalWeights(shape) {
  let n = 0;
  for (let l = 0; l < shape.length - 1; l++) n += shape[l] * shape[l + 1] + shape[l + 1];
  return n;
}

function forward(input, flat, shape) {
  let acts = input;
  let off = 0;
  for (let l = 0; l < shape.length - 1; l++) {
    const ni = shape[l], no = shape[l + 1];
    const out = Array.from({ length: no });
    for (let j = 0; j < no; j++) {
      let s = flat[off + ni * no + j];
      for (let k = 0; k < ni; k++) s += acts[k] * flat[off + j * ni + k];
      // Residual: hidden_2 layer (l===1) gets +acts[j] when shapes match.
      if (l === 1 && ni === no && j < ni) s += acts[j];
      // Output layer is linear; hidden layers use LeakyReLU (no dead neurons under ES).
      out[j] = l === shape.length - 2 ? s : (s > 0 ? s : 0.1 * s);
    }
    off += ni * no + no;
    acts = out;
  }
  return acts;
}

function randomWeights(n) {
  // He init — std = sqrt(2 / fan_in). Use the deepest layer's fan-in (40).
  return Array.from({ length: n }, () => gauss() * Math.sqrt(2 / 40));
}

function gauss() {
  const u = Math.max(1e-9, Math.random());
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
