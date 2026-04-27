# Code Arena

Competitive grid Battle Royale where users submit JS bots that play 10-tick matches with fog-of-war vision.

Plan: see `/Users/anhhong/.claude/plans/i-want-create-a-ethereal-hammock.md`

## Architecture — Hexagonal (ports & adapters)

```
packages/
  domain/        ← pure game logic — types, world, tick resolver, fog-of-war,
                   Glicko-2 rating math. ZERO infra imports.
  application/   ← use cases + ports (interfaces).
                   "What the system does" without saying how.
  adapters/      ← concrete implementations of the ports:
                   Drizzle repos · nsjail/subprocess sandbox · acorn validator ·
                   in-process pubsub · system clock.
  db/            ← Drizzle schema + connection + UUIDv7 generator.

apps/web/        ← Next.js shell: pages, API routes, WS, schedulers.
                   composition.ts is the only file that imports adapters.
                   Pages and routes call use cases through the composition root.

bots/runtime/    ← bot harness (injects helpers as globals).
bots/samples/    ← single-file bot examples (random, greedy, defensive, hunter).
docs/HELPERS.md  ← reference for the helper globals available in bots.
scripts/         ← `local-match.ts` runs a match without touching the DB.
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
- [x] nsjail sandbox with subprocess fallback
- [x] Glicko-2 ratings · 5-min matchmaking with rating-band + wildcard slots
- [x] Live WebSocket spectator + canvas replay viewer
- [ ] Sim worker / balance dashboard
- [ ] Admin panel UI
- [ ] Per-bot CSV/JSON export endpoint

## Run a local match (no DB needed)

```sh
bun scripts/local-match.ts \
  --bots bots/samples/hunter-bot.js,bots/samples/greedy-bot.js,bots/samples/defensive-bot.js,bots/samples/random-bot.js \
  --seed 42 --ticks 10 --out replay.json
```

## Run the web app locally

```sh
cp .env.example apps/web/.env   # fill DATABASE_URL, AUTH_SECRET, GOOGLE_CLIENT_*
cd apps/web
bun run dev                     # http://localhost:3000
```

## Tests

```sh
bun test          # 50 unit tests across domain / adapters / db
bun run typecheck
bun run lint
```

## Writing bots

Single file. No imports. Default-export `decide(observation, state)`.
Full helper reference: **[docs/HELPERS.md](./docs/HELPERS.md)**.

```js
export default function decide(obs) {
  const dir = bestAttackDir(obs);
  if (dir) return { type: "ATTACK", dir };
  if (canPickup(obs)) return { type: "PICKUP" };
  const item = nearestItem(obs);
  if (item) return { type: "MOVE", dir: dirTo(item.dx, item.dy) };
  return { type: "MOVE", dir: safestDir(obs) };
}
```

## Deploy

Render free tier + Neon free tier, no credit card required. See [DEPLOY.md](./DEPLOY.md).
