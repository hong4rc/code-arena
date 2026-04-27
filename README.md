# Code Arena

Competitive grid Battle Royale where users submit JS bots that play 10-tick matches with fog-of-war vision.

Plan: see `/Users/anhhong/.claude/plans/i-want-create-a-ethereal-hammock.md`

## Status

- [x] Monorepo + strict tooling (Bun workspaces, TS strict, ESLint flat, lefthook)
- [x] `@arena/engine` — pure game engine, 23 unit tests pass
- [x] Sample bots (random, greedy, defensive, hunter) + SDK + template
- [x] `@arena/runner` — local match runner (subprocess + JSON-lines stdio)
- [x] nsjail wrapper (with graceful fallback when the host kernel rejects it)
- [x] DB schema (Drizzle + Supabase)
- [x] API routes (auth, bot CRUD, validation, clone)
- [x] Web UI (Next.js, replay viewer, live spectator, leaderboard)
- [x] Scheduler + matchmaking (Glicko-2)
- [x] Render + Supabase deploy config (free tier, no credit card)
- [ ] Sim worker / balance dashboard
- [ ] Admin panel UI
- [ ] Per-bot CSV/JSON export endpoint

## Run a local match (no DB needed)

```sh
bun packages/runner/src/cli.ts \
  --bots bots/samples/hunter-bot.js,bots/samples/greedy-bot.js,bots/samples/defensive-bot.js,bots/samples/random-bot.js \
  --seed 42 --ticks 10 --out replay.json
```

## Run the web app locally

```sh
cp .env.example apps/web/.env   # fill Supabase + DATABASE_URL
cd apps/web
bun run dev                     # http://localhost:3000
```

## Tests

```sh
bun test          # 41 unit tests across engine / validation / rating
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

Render free tier + Supabase free tier, no credit card required. See [DEPLOY.md](./DEPLOY.md).
