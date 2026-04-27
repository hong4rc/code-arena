// god-bot v3 — self-tuning, dash-aware. Uses the persistent params store:
//   • Loads its tuning knobs from `state.params` on the first tick (the runner
//     hydrates this from the bot_params table).
//   • Tracks recent placements in `state.params.recent` (rolling 10).
//   • At end-of-match the runner snapshots `state.params` as a new version.
//
// Tuning knobs (all live in state.params, all hill-climbed):
//   healThreshold     — HP fraction at which we use HEAL (default 0.55)
//   shieldDistance    — enemy distance at which a predictive SHIELD pops (8)
//   dashTriggerHp     — HP fraction below which DASH is used to bail (0.35)
//   idealRange        — preferred standoff distance from focus target (5)
//   detourCap         — max cells we'll detour for an item (6)
//
// Hill-climb logic: every 4 matches the bot picks a knob and nudges it ±step.
// If average placement improves over the next 4 matches it keeps the change,
// otherwise it reverts. Simple but converges across ~30 matches.
//
// Action priority: ZONE > heal/shield (with combo) > dash-bail > dodge bullets >
// rotate to nextZone > guaranteed kill > lead-shoot > melee > kite > loot > drift.

const DEFAULT_PARAMS = {
  healThreshold: 0.55,
  shieldDistance: 8,
  dashTriggerHp: 0.35,
  idealRange: 5,
  detourCap: 6,
  // book-keeping
  recent: [],            // last 10 placements
  matchesPlayed: 0,
  experiment: null,      // { knob, prevValue, baseline, samples } during a tuning round
};
const KNOBS = ["healThreshold", "shieldDistance", "dashTriggerHp", "idealRange", "detourCap"];
const NUDGE = { healThreshold: 0.05, shieldDistance: 1, dashTriggerHp: 0.05, idealRange: 1, detourCap: 1 };
const BOUNDS = {
  healThreshold: [0.3, 0.8],
  shieldDistance: [3, 12],
  dashTriggerHp: [0.15, 0.6],
  idealRange: [2, 8],
  detourCap: [2, 12],
};

export default function decide(obs, state) {
  // Hydrate tuning knobs (runner injected `state.params` from DB before tick 0).
  state.params = { ...DEFAULT_PARAMS, ...state.params };
  const p = state.params;

  // Per-match scratch (cleared each match because state is per-process).
  state.hpHistory ??= [];
  state.lastDirs ??= [];
  state.focusTarget ??= null;
  state.lastShield ??= -100;

  const velocity = trackEnemies(obs, state);
  const enemies = visibleBots(obs);
  const incoming = incomingBullets(obs);
  const adj = adjacentBots(obs);
  const close = enemies.filter((e) => e.dist <= 5);

  // Track HP loss rate.
  state.hpHistory.push({ tick: obs.tick, hp: obs.self.hp });
  while (state.hpHistory.length > 4) state.hpHistory.shift();
  const oldest = state.hpHistory[0];
  const hpLossRate = oldest ? oldest.hp - obs.self.hp : 0;
  const bleedingFast = hpLossRate >= 25;

  // Record placement at the end of the match for the next-match learning step.
  // We treat tick==0 of the *next* match as a no-op for this; placement gets
  // logged via `obs.roster` once we're the only bot or the match cap is hit.
  recordPlacementIfMatchOver(obs, p);

  // ── 1. ZONE non-negotiable ────────────────────────────────────
  if (!inZone(obs)) return { type: "MOVE", dir: dirToZone(obs) };

  // ── 2. EMERGENCY DASH-BAIL ────────────────────────────────────
  // Low HP, threatened, and DASH is up → cover ground fast away from danger.
  if (lowHp(obs, p.dashTriggerHp) && (incoming.length > 0 || close.length > 0) && canDash(obs)) {
    const dir = bestDashDir(obs);
    if (dir) return { type: "DASH", dir };
  }

  // ── 3. SHIELD-then-HEAL combo ─────────────────────────────────
  const threatened = incoming.length > 0 || adj.length > 0 || close.length > 0;
  const shieldReady = obs.tick - state.lastShield > 8;
  if (lowHp(obs, 0.4) && hasItem(obs, "SHIELD") && threatened && shieldReady) {
    state.lastShield = obs.tick;
    return { type: "USE", item: "SHIELD" };
  }
  if (lowHp(obs, p.healThreshold) && hasItem(obs, "HEAL")) {
    return { type: "USE", item: "HEAL" };
  }

  // ── 4. PREDICTIVE SHIELD ──────────────────────────────────────
  const inShootRange = enemies.filter((e) => e.dist <= p.shieldDistance);
  if (hasItem(obs, "SHIELD") && shieldReady
      && (incoming.length >= 2 || (inShootRange.length >= 2 && bleedingFast))) {
    state.lastShield = obs.tick;
    return { type: "USE", item: "SHIELD" };
  }

  // ── 5. SPEED_BOOST in endgame ────────────────────────────────
  if (hasItem(obs, "SPEED_BOOST") && isEndgame(obs) && enemies.length > 0) {
    return { type: "USE", item: "SPEED_BOOST" };
  }

  // ── 6. MULTI-BULLET EVASION ──────────────────────────────────
  if (incoming.length > 0) {
    const dir = dodgeDir(obs, incoming);
    if (dir) return { type: "MOVE", dir };
  }

  // ── 7. ZONE rotation 30 ticks ahead (DASH if far + cooldown ready) ────
  const tts = ticksUntilShrink(obs);
  if (tts !== null && tts <= 30 && !inNextZone(obs)) {
    const d = dirToNextZone(obs);
    if (d) {
      // Use DASH for long rotations to outrun the closing zone.
      if (canDash(obs) && tts <= 15) return { type: "DASH", dir: d };
      return { type: "MOVE", dir: d };
    }
  }

  // ── 8. GUARANTEED KILLS ──────────────────────────────────────
  for (const dir of DIRS) {
    if (canKill(obs, dir)) return { type: "ATTACK", dir };
  }

  // ── 9. FOCUS FIRE: lead-shot ────────────────────────────────
  if (canShoot(obs) && enemies.length > 0) {
    const focus = pickFocus(state, enemies);
    state.focusTarget = focus.botId;
    return { type: "SHOOT", target: leadShot(obs, focus, velocity[focus.botId], { bulletSpeed: 5 }) };
  }

  // ── 10. ADJACENT MELEE ───────────────────────────────────────
  for (const dir of DIRS) {
    if (canAttack(obs, dir)) return { type: "ATTACK", dir };
  }

  // ── 11. KITE if pinned or bleeding ───────────────────────────
  if (bleedingFast || close.length >= 2) {
    const score = (e) => 1 / Math.max(1, e.dist);
    const cx = close.reduce((a, e) => a + e.dx * score(e), 0);
    const cy = close.reduce((a, e) => a + e.dy * score(e), 0);
    if (canDash(obs)) {
      const d = bestDashDir(obs);
      if (d) return { type: "DASH", dir: d };
    }
    const d = smartMove(obs, fleeFrom(cx, cy));
    if (d) return rememberDir(state, { type: "MOVE", dir: d });
  }

  // ── 12. LOOT (capped detour, knob: detourCap) ────────────────
  if (canPickup(obs)) return { type: "PICKUP" };
  const want = ["WEAPON"];
  if (!hasItem(obs, "HEAL")) want.push("HEAL");
  if (!hasItem(obs, "SHIELD")) want.push("SHIELD");
  if (!hasItem(obs, "SPEED_BOOST")) want.push("SPEED_BOOST");
  for (const kind of want) {
    if (kind !== "WEAPON" && hasItem(obs, kind)) continue;
    const it = nearestItem(obs, kind);
    if (it && it.dist <= p.detourCap) {
      const d = smartMove(obs, dirTo(it.dx, it.dy));
      if (d) return rememberDir(state, { type: "MOVE", dir: d });
    }
  }

  // ── 13. RANGE MGMT (knob: idealRange) ────────────────────────
  const d = pickWeightedMove(obs, state, enemies, p);
  if (d) return rememberDir(state, { type: "MOVE", dir: d });

  return { type: "WAIT" };
}

// ─────────────────────────────────────────────────────────────────────
// Learning bookkeeping. Runs once at end-of-match, mutates state.params.
// ─────────────────────────────────────────────────────────────────────

function recordPlacementIfMatchOver(obs, p) {
  // Match ends when only ≤1 bot is alive in roster (we won) or this is the
  // last tick before zone collapse. Approximate by `aliveCount(obs) <= 1`.
  if (aliveCount(obs) > 1 && obs.tick < 800) return;     // not done yet
  if (p.__loggedMatch === true) return;                  // already booked this match
  p.__loggedMatch = true;
  p.matchesPlayed = (p.matchesPlayed ?? 0) + 1;
  // Placement = number of alive (incl. self) — 1 if we won, more for losses.
  // We don't have authoritative placement; use roster-alive as proxy.
  const myPlacement = obs.roster?.find((b) => b.alive)?.id === undefined ? 6 : aliveCount(obs);
  p.recent = [...(p.recent ?? []), myPlacement].slice(-10);

  // Hill-climb every 4 matches.
  const baseline = avg(p.recent);
  if (p.experiment) {
    p.experiment.samples += 1;
    if (p.experiment.samples >= 4) {
      const newAvg = avg(p.recent.slice(-4));
      // Lower placement = better (1 is win). Revert if worse.
      if (newAvg <= p.experiment.baseline) {
        // change improved (or matched) — keep it
      } else {
        p[p.experiment.knob] = p.experiment.prevValue;
      }
      p.experiment = null;
    }
  } else if (p.matchesPlayed % 4 === 0) {
    const knob = KNOBS[Math.floor(Math.random() * KNOBS.length)];
    const prev = p[knob];
    const dir = Math.random() < 0.5 ? -1 : 1;
    const next = clamp(prev + dir * NUDGE[knob], BOUNDS[knob][0], BOUNDS[knob][1]);
    p.experiment = { knob, prevValue: prev, baseline, samples: 0 };
    p[knob] = next;
  }
}

function avg(xs) { return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length; }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// ─────────────────────────────────────────────────────────────────────
// Tactical helpers (file-local).
// ─────────────────────────────────────────────────────────────────────

function dodgeDir(obs, incoming) {
  const score = { UP: 0, DOWN: 0, LEFT: 0, RIGHT: 0 };
  const dirVec = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };
  for (const b of incoming) {
    for (const d of DIRS) {
      const [dx, dy] = dirVec[d];
      score[d] += Math.max(0, dx * b.vx + dy * b.vy);
    }
  }
  const home = dirToZone(obs);
  if (home) score[home] -= 0.5;
  const ranked = [...DIRS].sort((a, b) => score[a] - score[b]);
  for (const d of ranked) if (canMove(obs, d)) return d;
  return null;
}

function focusScore(en) {
  return (101 - (en.hp ?? 100)) / Math.max(1, en.dist);
}

function pickFocus(state, enemies) {
  if (state.focusTarget) {
    const same = enemies.find((e) => e.botId === state.focusTarget);
    if (same) return same;
  }
  return enemies.reduce((best, e) => focusScore(e) > focusScore(best) ? e : best);
}

function rememberDir(state, action) {
  if (action.type === "MOVE") {
    state.lastDirs.push(action.dir);
    while (state.lastDirs.length > 4) state.lastDirs.shift();
  }
  return action;
}

function pickWeightedMove(obs, state, enemies, p) {
  const dirVec = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };
  const scored = [];
  const focus = enemies.find((e) => e.botId === state.focusTarget) ?? null;
  const cx = (obs.zone.xMin + obs.zone.xMax) / 2;
  const cy = (obs.zone.yMin + obs.zone.yMax) / 2;
  const homeDx = cx - obs.self.x;
  const homeDy = cy - obs.self.y;
  const last = state.lastDirs.at(-1);
  const streak = state.lastDirs.length >= 3
    && state.lastDirs.slice(-3).every((d) => d === last);

  for (const d of DIRS) {
    if (!canMove(obs, d)) continue;
    const [vx, vy] = dirVec[d];
    let s = 0;
    if (Math.sign(vx) === Math.sign(homeDx) && vx !== 0) s += Math.min(2, Math.abs(homeDx) / 10);
    if (Math.sign(vy) === Math.sign(homeDy) && vy !== 0) s += Math.min(2, Math.abs(homeDy) / 10);
    if (focus) {
      const ideal = isEndgame(obs) ? 3 : p.idealRange;
      const dot = vx * Math.sign(focus.dx) + vy * Math.sign(focus.dy);
      s += focus.dist > ideal ? dot * 1.5 : -dot;
    }
    for (const e of enemies) {
      if (e.dist <= 4) {
        const dot = vx * Math.sign(e.dx) + vy * Math.sign(e.dy);
        s -= dot * 1.2;
      }
    }
    if (streak && d === last) s -= 1.5;
    scored.push([d, s]);
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b[1] - a[1]);
  return scored[0][0];
}
