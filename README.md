# Code Arena

Competitive grid Battle Royale where users submit JS bots that play 90-second
PUBG-style matches: shrinking zone, bullets, dashes, fog-of-war vision,
2×2 multi-cell bots, weapon drops, Glicko-2 ladder.

## Architecture — Hexagonal (ports & adapters)

```
packages/
  domain/        ← pure game logic — types, world, tick resolver, fog-of-war,
                   Glicko-2 rating math. ZERO infra imports.
  application/   ← use cases + ports (interfaces).
                   "What the system does" without saying how.
  adapters/      ← concrete implementations of the ports:
                   Drizzle repos · subprocess sandbox · acorn validator ·
                   in-process pubsub · system clock.
  db/            ← Drizzle schema + connection + UUIDv7 generator.

apps/web/        ← Next.js shell: pages, API routes, WS, schedulers, trainer.
                   composition.ts is the only file that imports adapters.
                   Pages and routes call use cases through the composition root.

bots/runtime/    ← bot harness (injects helpers as globals, handles the
                   __init__/__finalize__ params protocol).
bots/samples/    ← single-file bot examples — heuristic + neural-net.
docs/HELPERS.md  ← reference for the helper globals available in bots.
scripts/         ← CLI tools (see "Scripts" below).
```

**Dependency rule**: `domain` ← `application` ← `adapters` ← `apps/web`.
Inner layers don't know about outer layers. `import-x/no-cycle` enforces this.

## Status

- [x] Hexagonal layout: domain / application / adapters / db / apps/web
- [x] Single-file bots with helper globals + comprehensive [docs/HELPERS.md](./docs/HELPERS.md)
- [x] Strict tooling: TS + import-x (no-cycle) + unicorn + react-hooks + jsx-a11y + @next/next
- [x] Auth: Better Auth + Google OAuth direct, no Supabase intermediary
- [x] Render free tier + Neon free tier deploy (see [DEPLOY.md](./DEPLOY.md)), no credit card
- [x] UUIDv7 IDs everywhere (time-sortable, B-tree-friendly)
- [x] Subprocess sandbox + AcornValidator static blocklist + per-tick wall timeout
- [x] Glicko-2 ratings · 5-min matchmaking with rating-band + wildcard slots
- [x] Live WebSocket spectator + canvas replay viewer
- [x] PUBG-style shrinking zone with announce-ahead nextZone
- [x] Bullets at any angle (DDA stepping) · DASH action · weapon drop on death
- [x] Persistent per-bot params (`bot_params` table, versioned) loaded each match
- [x] **In-process trainer** — admin toggles bots into evolution at `/admin/training`
- [x] Admin tools: data cleanup, custom matches, training targets
- [x] Sample neural-net bot (40→32→24→15) with hybrid rules + ES learning loop
- [ ] Sim worker / balance dashboard (per-match metrics live in `bun run stats`)
- [ ] Per-bot CSV/JSON export endpoint

## Run a local match (no DB needed)

```sh
bun scripts/local-match.ts \
  --bots bots/samples/hunter-bot.js,bots/samples/greedy-bot.js,bots/samples/defensive-bot.js,bots/samples/random-bot.js \
  --seed 42 --ticks 900 --out replay.json
```

## Run the web app locally

```sh
cp .env.example apps/web/.env   # fill DATABASE_URL, AUTH_SECRET, GOOGLE_CLIENT_*
bun run dev                     # http://localhost:3000
```

The dev server starts the Next.js app **plus** the in-process scheduler,
match runner pump, and bot trainer. Toggle features off via env:

| env | effect |
|---|---|
| `DISABLE_BACKGROUND=1` | skip scheduler + runner + trainer |
| `DISABLE_TRAINER=1` | only skip the trainer (keep matches running) |
| `SCHEDULE_CYCLE_MS=60000` | how often the matchmaker runs (default 5 min) |
| `TRAINER_BOT_IDS=<uuid>,<uuid>` | override the DB toggle for training targets |
| `TRAINER_MATCHES_PER_ROUND=30` | training matches per bot per round |
| `TRAINER_TICKS=300` | tick cap per training match (shorter = faster iteration) |

See `apps/web/src/server/trainer-driver.ts` for all `TRAINER_*` knobs.

## Tests

```sh
bun test          # 67 unit tests across domain / adapters / db
bun run typecheck
bun run lint
```

## Writing bots

Single file. No imports. Default-export `decide(observation, state)`.
Full helper reference: **[docs/HELPERS.md](./docs/HELPERS.md)**.

```js
export default function decide(obs) {
  if (!inZone(obs)) return { type: "MOVE", dir: dirToZone(obs) };
  for (const d of DIRS) if (canKill(obs, d)) return { type: "ATTACK", dir: d };
  if (canShoot(obs)) {
    const enemy = nearestBot(obs);
    if (enemy) return { type: "SHOOT", target: { dx: enemy.dx, dy: enemy.dy } };
  }
  if (canPickup(obs)) return { type: "PICKUP" };
  const item = nearestItem(obs);
  if (item) return { type: "MOVE", dir: dirTo(item.dx, item.dy) };
  return { type: "MOVE", dir: safestDir(obs) };
}
```

### Persistent params (cross-match memory)

Whatever a bot writes to `state.params` during a match is saved as a new
versioned row in `bot_params` and reloaded on the next match's first tick.
Optional `learn(info, state)` export gets `{ placement, won, hp, damageDealt,
itemsPicked }` at end-of-match, even if the bot died early. Used by `nn-bot`
to evolve neural-net weights via (1+1)-Evolution Strategy.

## Trainer

The platform runs a **continuous trainer** in-process. It watches bots flagged
`is_training_target` (toggle from `/admin/training`) and evolves their
`state.params` between matches, writing new versions to `bot_params`.

- **Opponents** for training matches are sampled from the rest of the live bot
  pool. Their params are **read but never written** — opponents stay frozen.
- The trainer **never touches** `matches`, `match_replays`, `ratings`,
  `match_queue`. Live ranked matches and the trainer are isolated.
- Train a specific bot from the CLI without admin toggles:
  ```sh
  bun run train --db-bot-id <uuid> --matches 500 --save-every 100
  ```

Full guide: **[docs/TRAINER.md](./docs/TRAINER.md)**.

## Scripts

| command | what |
|---|---|
| `bun run dev` | start the Next.js app (web + WS + scheduler + runner + trainer) |
| `bun run build` | next.js standalone production build |
| `bun run match` | run a one-off local match between bot files (no DB) |
| `bun run train` | train one bot for N matches (DB or file mode) |
| `bun run stats` | aggregate balance metrics over all finished matches |
| `bun run debug-match <id>` | per-tick action log for one match (compact format) |
| `bun run reset` | wipe matches/ratings/queue/params + reseed (`--user-bots` also drops user bots) |
| `bun run db:setup` | run drizzle migrations + seed sample bots |
| `bun run db:seed` | (re)seed sample bots — idempotent |
| `bun run db:migrate` | apply pending drizzle migrations |
| `bun run db:studio` | open Drizzle Studio to browse the DB |
| `bun scripts/upgrade-bot.ts --db-bot-id <uuid> --code <path>` | replace a DB bot's code from a file (for ops) |
| `bun scripts/inspect-bot.ts <uuid>` | print a bot's code + params summary |

## Deploy

Render free tier + Neon free tier, no credit card required. See [DEPLOY.md](./DEPLOY.md).
