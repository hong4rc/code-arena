// nn-bot — hybrid heuristic + neural-network bot.
//
// DESIGN: simple decisions are hand-coded rules. Hard decisions are learned.
//
//   RULES decide (in order):
//     1. Out of zone → DASH or MOVE toward zone center
//     2. Shrink imminent → rotate toward next zone
//     3. HP < 35% + HEAL → use HEAL
//     4. Bullet incoming + SHIELD → use SHIELD
//     5. Standing on item → PICKUP
//     6. Adjacent kill shot → ATTACK
//     7. Free SHOOT at any visible enemy → take it
//     8. SHIELD when ≥2 enemies in close range
//     9. Adjacent enemy + ATTACK → fight back
//
//   NN decides (the hard part):
//     • Where to move when there's no immediate threat —
//       chase / flee / hold / loot / kite. 8 outputs:
//         MOVE_{UP,DOWN,LEFT,RIGHT}, DASH_{UP,DOWN,LEFT,RIGHT}
//
// Architecture: 28 features → tanh(20) → tanh(16) → linear(8). ~1100 weights.
// Small enough to train quickly, deep enough for non-trivial policies.

const SHAPE = [28, 20, 16, 8];

const NN_ACTIONS = [
  "MOVE_UP", "MOVE_DOWN", "MOVE_LEFT", "MOVE_RIGHT",
  "DASH_UP", "DASH_DOWN", "DASH_LEFT", "DASH_RIGHT",
];

export default function decide(obs, state) {
  if (!state.__init) {
    state.params = state.params ?? {};
    const need = totalWeights(SHAPE);
    if (!Array.isArray(state.params.weights) || state.params.weights.length !== need) {
      state.params.weights = randomWeights(need);
    }
    state.__init = true;
  }

  // ── RULES — always-correct moves first ───────────────────────────
  // 1. Out of zone — get back NOW.
  if (!inZone(obs)) {
    const dir = dirToZone(obs);
    if (dir) {
      if (canDash(obs) && canMove(obs, dir)) return { type: "DASH", dir };
      if (canMove(obs, dir)) return { type: "MOVE", dir };
    }
  }
  // 2. Shrink imminent + we're not in next zone — rotate.
  const tts = ticksUntilShrink(obs);
  if (tts !== null && tts <= 25 && !inNextZone(obs)) {
    const dir = dirToNextZone(obs);
    if (dir) {
      if (tts <= 10 && canDash(obs) && canMove(obs, dir)) return { type: "DASH", dir };
      if (canMove(obs, dir)) return { type: "MOVE", dir };
    }
  }
  // 3. HP critical — heal.
  if (lowHp(obs, 0.35) && hasItem(obs, "HEAL")) {
    return { type: "USE", item: "HEAL" };
  }
  // 4. Bullet inbound + SHIELD — block.
  if (incomingBullets(obs).length > 0 && hasItem(obs, "SHIELD")) {
    return { type: "USE", item: "SHIELD" };
  }
  // 5. Standing on an item — pick it up.
  if (canPickup(obs)) return { type: "PICKUP" };
  // 6. Adjacent kill — finish them.
  for (const d of DIRS) {
    if (canKill(obs, d)) return { type: "ATTACK", dir: d };
  }
  // 7. Cooldown ready + any visible enemy — shoot. Bullets > melee.
  if (canShoot(obs)) {
    const enemy = nearestBot(obs);
    if (enemy) return { type: "SHOOT", target: { dx: enemy.dx, dy: enemy.dy } };
  }
  // 8. ≥2 enemies in close range + SHIELD — preemptive block.
  const closeEnemies = visibleBots(obs).filter((e) => e.dist <= 5);
  if (closeEnemies.length >= 2 && hasItem(obs, "SHIELD")) {
    return { type: "USE", item: "SHIELD" };
  }
  // 9. Adjacent enemy — attack. Free damage.
  for (const d of DIRS) {
    if (canAttack(obs, d)) return { type: "ATTACK", dir: d };
  }
  // 10. SPEED_BOOST in endgame — kiting matters more.
  if (hasItem(obs, "SPEED_BOOST") && isEndgame(obs) && visibleBots(obs).length > 0) {
    return { type: "USE", item: "SPEED_BOOST" };
  }

  // ── NN POLICY — strategic movement ───────────────────────────────
  const features = featurize(obs);
  const logits = forward(features, state.params.weights, SHAPE);
  const ranked = [...logits.keys()].sort((a, b) => logits[b] - logits[a]);
  for (const idx of ranked) {
    const a = realiseNNAction(NN_ACTIONS[idx], obs);
    if (a) return a;
  }
  return { type: "WAIT" };
}

// ─────────────────────────────────────────────────────────────────────
// Features — focused on what's NOT covered by rules:
// where to move strategically given the threat / zone / loot landscape.
// ─────────────────────────────────────────────────────────────────────

function featurize(obs) {
  const f = Array.from({ length: SHAPE[0] }, () => 0);
  let i = 0;

  // Self stats (4)
  f[i++] = obs.self.hp / 100;
  f[i++] = (obs.self.shootCooldown ?? 0) / 8;
  f[i++] = (obs.self.dashCooldown ?? 0) / 8;
  f[i++] = aliveCount(obs) / 6;

  // Zone center direction relative to me (4) — the NN learns to drift toward
  // (or away from) center given enemy positioning.
  const cx = (obs.zone.xMin + obs.zone.xMax) / 2;
  const cy = (obs.zone.yMin + obs.zone.yMax) / 2;
  const dx = (cx - obs.self.x) / 50;
  const dy = (cy - obs.self.y) / 50;
  f[i++] = Math.tanh(dx);
  f[i++] = Math.tanh(dy);
  f[i++] = (obs.zone.ticksUntilShrink ?? 100) / 100;
  f[i++] = inNextZone(obs) ? 1 : 0;

  // Nearest enemy (5) — the most important thing to react to.
  const enemies = visibleBots(obs).sort((a, b) => a.dist - b.dist);
  const e1 = enemies[0];
  if (e1) {
    f[i++] = 1;
    f[i++] = e1.dist / 14;
    f[i++] = e1.dx / 14;
    f[i++] = e1.dy / 14;
    f[i++] = (e1.hp ?? 100) / 100;
  } else { i += 5; }

  // Second-nearest enemy (5) — for flanking awareness.
  const e2 = enemies[1];
  if (e2) {
    f[i++] = 1;
    f[i++] = e2.dist / 14;
    f[i++] = e2.dx / 14;
    f[i++] = e2.dy / 14;
    f[i++] = (e2.hp ?? 100) / 100;
  } else { i += 5; }

  // Nearest item (4).
  const it = nearestItem(obs);
  if (it) {
    f[i++] = 1;
    f[i++] = it.dist / 14;
    f[i++] = it.dx / 14;
    f[i++] = it.dy / 14;
  } else { i += 4; }

  // Threat aggregate (3): bullets + total enemies + own HP missing.
  f[i++] = visibleBullets(obs).length / 3;
  f[i++] = enemies.length / 5;
  f[i++] = 1 - obs.self.hp / 100;

  // Inventory weapon flag — slightly changes optimal aggression (1).
  f[i] = obs.self.inventory.includes("WEAPON") ? 1 : 0;

  return f;
}

// ─────────────────────────────────────────────────────────────────────
// NN action realisation — only MOVE / DASH directions. Returns null if
// the chosen direction is illegal so the caller falls through to next.
// ─────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────
// MLP forward pass.
//
// Activations:
//   • Hidden layers: LeakyReLU(0.1).
//     Plain ReLU dies (zero output) for ~50% of random inits — wasted
//     capacity in an ES-evolved net where dead neurons can't recover via
//     gradient flow. LeakyReLU keeps a small slope on negatives.
//   • Output layer: linear (raw logits → argmax for action selection).
//     No softmax: we don't sample, we just take the highest legal action.
//
// Easy swaps (edit `act` below):
//   tanh:    Math.tanh(s)
//   sigmoid: 1 / (1 + Math.exp(-s))   — outputs (0,1)
//   relu:    Math.max(0, s)           — fast but can dead-neuron
//   leaky:   s > 0 ? s : 0.1 * s      — current default
//   gelu:    0.5 * s * (1 + Math.tanh(0.7978845608 * (s + 0.044715 * s ** 3)))
// ─────────────────────────────────────────────────────────────────────

function act(s) {
  return s > 0 ? s : 0.1 * s; // LeakyReLU(0.1)
}

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
      out[j] = l === shape.length - 2 ? s : act(s);
    }
    off += ni * no + no;
    acts = out;
  }
  return acts;
}

function randomWeights(n) {
  // He init for ReLU-family activations: std = sqrt(2 / fan_in).
  // We don't know fan_in per weight here, so use a single conservative scale
  // tuned for the deepest layer of the default SHAPE. Fine in practice; ES
  // adapts σ around whatever the init gave us anyway.
  return Array.from({ length: n }, () => gauss() * 0.3);
}

function gauss() {
  const u = Math.max(1e-9, Math.random());
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
