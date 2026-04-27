# Bot Trainer

The platform runs a continuous **bot trainer** alongside the matchmaker, in
the same Next.js server process. It evolves any bot you flag as a training
target, writing new versioned param blobs to `bot_params` between matches.

It does **not** touch `matches`, `match_replays`, `match_participants`,
`ratings`, or `match_queue` — live ranked matches and training are isolated.

---

## Quickstart

1. Sign in as an admin → header shows a red **Training** link.
2. Open `/admin/training`.
3. Click "Start training" on the bot(s) you want evolved.

Within ~10 s the trainer starts running rounds. Tail the server log:

```
[trainer] training: hong, hong2
[trainer] hong             round=1 match=30 win=12/30 (40%) champion=1.65 σ=0.040 → bot_params v3
[trainer] hong2            round=1 match=30 win=8/30  (27%) champion=1.91 σ=0.040 → bot_params v3
```

Each round = `TRAINER_MATCHES_PER_ROUND` matches (default 30). Trainer sleeps
`TRAINER_SLEEP_MS` between rounds and re-checks the target list each time, so
you can toggle bots in/out from the UI without restarting the server.

---

## How it works

For each training-target bot:

1. **Load** latest code from `bot_versions` and latest params from `bot_params`.
2. **Sample N opponents** at random from the active bot pool (excluding
   trainees themselves). Default `TRAINER_OPPONENT_POOL_SIZE=5`.
3. **Run a round of matches**: each match plays a *candidate* = champion +
   Gaussian noise on every numeric leaf of params (with `TRAINER_MUTATION_RATE`
   probability per leaf).
4. **Score** each match: `placement − 0.005·damage − 0.1·picks − 0.005·HP`.
5. After every `TRAINER_BATCH` matches: if the candidate's average is ≤ the
   champion's, **promote** it (σ ← σ · 0.85). Otherwise discard (σ ← σ · 1.2).
6. **Persist** the champion as a new `bot_params` row.

Standard self-adaptive (1+1)-Evolution Strategy. No bot-side learning code
needed — any bot whose `decide()` reads numeric values from `state.params`
will train automatically. Excluded keys (counters, history) are not perturbed:
`matchesPlayed`, `evals`, `score`, `scores`, `recent`, `experiment`.

---

## Bot-side contract

Whatever the bot stores in `state.params` during a match is what the trainer
treats as the parameter blob. Two patterns:

### Treat params as a flat weight vector (neural-net style)

```js
export default function decide(obs, state) {
  // Trainer hydrates state.params from DB on tick 0.
  state.__init ??= initWeights(state);
  return policy(featurize(obs), state.params.weights);
}
```

### Treat params as named knobs

```js
export default function decide(obs, state) {
  state.params ??= {};
  state.params.healThreshold ??= 0.5;
  state.params.aggression ??= 0.7;
  if (lowHp(obs, state.params.healThreshold) && hasItem(obs, "HEAL")) {
    return { type: "USE", item: "HEAL" };
  }
  // … rest of policy reads state.params.aggression …
}
```

The trainer perturbs both equally — it walks every numeric leaf in the JSON.

### Optional: `learn` export for end-of-match bookkeeping

```js
export function learn(info, state) {
  // info = { placement, won, tick, hp, damageDealt, itemsPicked, totalBots }
  state.params.recent = [...(state.params.recent ?? []), info.placement].slice(-10);
}
```

The harness invokes `learn(info, state)` (if exported) right before sending
`state.params` back to the runner — runs even if the bot died mid-match. The
trainer doesn't depend on `learn` existing; it's purely for the bot's own
hand-rolled accounting.

---

## CLI alternative

For one-shot training without flipping the admin toggle:

```sh
# DB mode — train a bot stored in the DB, save params back to bot_params
bun run train --db-bot-id <uuid> --matches 500 --save-every 100

# Eval mode — measure true winrate without learning
bun run train --db-bot-id <uuid> --matches 200 --eval

# File mode — train a sample-on-disk, save to .training/<name>.json
bun run train --bot bots/samples/nn-bot.js --matches 1000

# Push a trained file's final params to the DB
bun run train --bot bots/samples/nn-bot.js --matches 500 --push-to-db
```

Common flags: `--opponents path1.js,path2.js`, `--sigma`, `--sigma-max`,
`--batch`, `--mutation-rate`, `--ticks`, `--width`, `--height`, `--exclude`.

---

## Tuning

All tunables come from env (or CLI flags for the one-shot trainer):

| env | default | what |
|---|---|---|
| `TRAINER_BOT_IDS` | _(unset, uses DB toggle)_ | comma-separated UUIDs to train |
| `TRAINER_OPPONENT_POOL_SIZE` | `5` | how many other bots sampled per round |
| `TRAINER_INCLUDE_OFFICIAL` | `1` | include official sample bots in opponents |
| `TRAINER_MATCHES_PER_ROUND` | `30` | matches per bot per round |
| `TRAINER_TICKS` | `300` | tick cap per training match |
| `TRAINER_SIGMA` | `0.04` | initial perturbation σ |
| `TRAINER_SIGMA_MAX` | `0.15` | cap on adapted σ |
| `TRAINER_BATCH` | `12` | matches per candidate evaluation |
| `TRAINER_MUTATION_RATE` | `0.08` | fraction of weights perturbed/match |
| `TRAINER_SLEEP_MS` | `10000` | pause between rounds |
| `TRAINER_RELOAD_TARGETS_EVERY` | `1` | rounds between target-list refreshes |
| `DISABLE_TRAINER` | _(unset)_ | `1` to skip the trainer at startup |

### Rules of thumb

- **High-dim params (≥1000 weights)**: `--mutation-rate 0.05`, `--batch 12`,
  `--sigma 0.04`. Sparse perturbation is critical — perturbing every weight
  every match destroys signal.
- **Few knobs (< 10)**: `--mutation-rate 1`, `--batch 3`, `--sigma 0.05`.
- **σ growing toward `sigma_max`**: stuck in local optimum. Drop sigma_max,
  raise batch.
- **σ shrinking below 0.01**: bot is converged. Lower learning rate, or stop.

### Stopping training cleanly

Toggle the bot off in `/admin/training`. The trainer notices on the next
round and drops it from the rotation. To stop the entire trainer set
`DISABLE_TRAINER=1` on the deployed service env and restart.

---

## Inspecting trained params

```sql
SELECT version, created_at,
       (params->>'sigma')::float                 AS sigma,
       jsonb_array_length(params->'weights')     AS weight_count
FROM bot_params
WHERE bot_id = '<uuid>'
ORDER BY version DESC LIMIT 20;
```

Old versions are kept forever — manual rollback is just inserting an old
row's `params` payload as a fresh version.

```sh
bun scripts/inspect-bot.ts <uuid>          # quick code + params summary
bun run train --db-bot-id <uuid> --matches 100 --eval
```
