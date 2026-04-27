# Code Arena — Deploy Guide

Free tier, no credit card. **~30 min from zero to live URL.**

| Layer | Service | Free quota | CC? |
|---|---|---|---|
| App container | Render web service | 512 MB / 750 hr | ❌ |
| Postgres | Neon | 0.5 GB | ❌ |
| OAuth | Google Cloud | unlimited | ❌ |
| Anti-sleep ping | UptimeRobot | 50 monitors | ❌ |

---

## Step 1 — Push to GitHub

```sh
git push
```
You should already have the `code-arena` repo on github.com/hong4rc.

---

## Step 2 — Neon (Postgres)

1. <https://console.neon.tech> → **New project**
2. Name `code-arena`, region nearest your Render region.
3. Copy the connection string Neon shows. It looks like:
   ```
   postgresql://USER:PASS@ep-xxx.us-east-2.aws.neon.tech/code_arena?sslmode=require
   ```
4. **Save this** — you'll paste it into Render later as `DATABASE_URL`.

---

## Step 3 — Google Cloud OAuth client

1. <https://console.cloud.google.com> → top bar → **New Project** → `code-arena` → select it.
2. Sidebar (≡) → **APIs & Services → OAuth consent screen** → fill in:
   - App name: `Code Arena`
   - User support email + Developer email: yours
   - User type / Audience: **External**
   - Save and skip the rest.
3. Sidebar → **APIs & Services → Credentials → + Create Credentials → OAuth client ID**.
4. Application type: **Web application**. Name: `Code Arena web`.
5. **Authorized redirect URIs** — add **two**:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://code-arena.onrender.com/api/auth/callback/google` *(use the real Render URL once you have it after Step 4)*
6. Click **Create**. The modal shows two values — **copy both right now**:
   - **Client ID** → save as `GOOGLE_CLIENT_ID`
   - **Client secret** → save as `GOOGLE_CLIENT_SECRET`

---

## Step 4 — Render (deploy)

1. <https://dashboard.render.com> → **New + → Blueprint** → connect `hong4rc/code-arena`.
2. Render reads `render.yaml`, previews one Web Service, click **Apply**.
3. First build takes ~5–8 min (compiles nsjail). Watch the build log.
4. When it shows "Live", you'll see a URL like `https://code-arena.onrender.com`. **Save this URL.**
5. Go back to **Step 3.5** and replace the placeholder Render URL in Google Cloud OAuth redirect URIs with this real one. Save.

---

## Step 5 — Set Render environment variables

**Render dashboard → code-arena → Environment** — add each row below:

| Variable | Where to get the value |
|---|---|
| `DATABASE_URL` | from **Step 2** (Neon connection string) |
| `AUTH_SECRET` | run locally: `openssl rand -base64 32` and paste the output |
| `AUTH_URL` | your Render URL, e.g. `https://code-arena.onrender.com` |
| `NEXT_PUBLIC_APP_URL` | same as `AUTH_URL` |
| `GOOGLE_CLIENT_ID` | from **Step 3.6** |
| `GOOGLE_CLIENT_SECRET` | from **Step 3.6** |

`NODE_ENV=production` and `PORT=3000` are already set by `render.yaml` — don't add them again.

Render auto-redeploys on save. Wait ~1 min for it to come back up.

---

## Step 6 — Run migrations + seed (from your laptop)

Use the **same** Neon URL from Step 2. From the repo root:

```sh
export DATABASE_URL='postgresql://USER:PASS@ep-xxx.us-east-2.aws.neon.tech/code_arena?sslmode=require'
bun install --frozen-lockfile

cd packages/db && bun run migrate    # creates all tables
cd ../..
bun packages/db/src/seed.ts          # adds system user, Season 1, 4 sample bots
```

Verify in Neon **SQL Editor**:
```sql
SELECT count(*) FROM users;        -- 1
SELECT count(*) FROM bots;         -- 4 (the official samples)
SELECT name, is_active FROM seasons;  -- "Season 1" / true
```

---

## Step 7 — Sign in once + promote yourself to admin

1. Open your Render URL → **Sign in** → Google flow → land on `/bots`.
2. Neon **SQL Editor**:
   ```sql
   UPDATE users SET role = 'admin' WHERE email = 'YOU@example.com';
   ```

---

## Step 8 — UptimeRobot keep-alive

Render free sleeps after 15 min idle. Ping `/api/health` every 5 min to keep it warm.

1. <https://uptimerobot.com> → sign up.
2. **+ Add New Monitor**:
   - Type: **HTTPS**
   - URL: `https://code-arena.onrender.com/api/health`
   - Interval: **5 minutes**

That's it.

---

## Step 9 — Smoke test

1. `/samples` → click **Clone** on `greedy-bot` → editor opens with the code.
2. **Save** → validation runs, "OK" → bot is enrolled in matchmaking.
3. Repeat clone+save 19 more times (matchmaker needs ≥ 20 active bots before it'll create a match) — or insert a custom match via SQL (see "Day-2" below).
4. Open `/matches`. After up to 5 min you'll see one in `running`. Click **Watch live →** to see ticks stream over WebSocket on the canvas.

---

## Local development

`apps/web/.env`:

| Variable | Value |
|---|---|
| `DATABASE_URL` | your Neon URL |
| `AUTH_SECRET` | `openssl rand -base64 32` (or any random string for dev) |
| `AUTH_URL` | `http://localhost:3000` |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` |
| `GOOGLE_CLIENT_ID` | from Google Cloud (the same OAuth client allows localhost too) |
| `GOOGLE_CLIENT_SECRET` | from Google Cloud |

```sh
cd apps/web && bun run dev      # http://localhost:3000
```

Run a match without DB:
```sh
bun scripts/local-match.ts \
  --bots bots/samples/greedy-bot.js,bots/samples/hunter-bot.js,bots/samples/defensive-bot.js \
  --seed 42 --ticks 10
```

---

## Day-2 ops

**Deploy a code change** — `git push`. Render auto-deploys.

**Apply a new migration** — schema change in `packages/db/src/schema.ts`, then:
```sh
cd packages/db && bun run generate    # writes new SQL under drizzle/
git add . && git commit && git push
# then apply against Neon (only the runtime DB needs migrations applied):
export DATABASE_URL='your Neon URL'
cd packages/db && bun run migrate
```

**Insert a custom match** (until the admin UI ships) — Neon SQL Editor:
```sql
WITH m AS (
  INSERT INTO matches (season_id, kind, status, seed)
  SELECT id, 'custom', 'pending', floor(random()*1000000)::int FROM seasons WHERE is_active LIMIT 1
  RETURNING id
)
INSERT INTO match_participants (match_id, bot_id, bot_version_id)
SELECT m.id, b.id, b.current_version_id FROM m, bots b WHERE b.is_official LIMIT 10;
```

**Tail logs** — Render dashboard → code-arena → **Logs**.

---

## Env var reference card

| Variable | Where set | Source / value |
|---|---|---|
| `DATABASE_URL` | Render env, local `.env` | Neon connection string |
| `AUTH_SECRET` | Render env, local `.env` | `openssl rand -base64 32` |
| `AUTH_URL` | Render env, local `.env` | Public URL of the app |
| `NEXT_PUBLIC_APP_URL` | Render env, local `.env` | Same as `AUTH_URL` |
| `GOOGLE_CLIENT_ID` | Render env, local `.env` | Google Cloud → Credentials |
| `GOOGLE_CLIENT_SECRET` | Render env, local `.env` | Google Cloud → Credentials |
| `NODE_ENV` | `render.yaml` (already set) | `production` |
| `PORT` | `render.yaml` (already set) | `3000` |
| `DISABLE_BACKGROUND` | optional | `1` to disable scheduler/runner (e.g. CI) |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `redirect_uri_mismatch` from Google | The redirect URI in Google Cloud → Credentials must be character-perfect: `https://code-arena.onrender.com/api/auth/callback/google`. |
| Sign-in succeeds but redirects to a 404 | `AUTH_URL` doesn't match your real URL. Update on Render and redeploy. |
| App sleeps despite UptimeRobot | Verify the monitor URL in UptimeRobot returns 200. |
| Build fails on `nsjail` step | Render's free build minutes can be slow; rerun. nsjail isn't required at runtime — runner falls back to plain subprocess. |
| `DATABASE_URL not set` in Render logs | You forgot Step 5, or set it via `render.yaml`'s `value:` field instead of the dashboard. Use the dashboard. |
| Scheduler logs `only N bots — need 20` | Clone more samples, or insert a custom match via SQL above. |

---

## Costs & limits at a glance

| Resource | Free tier | Hits limit when |
|---|---|---|
| Render free | 512 MB / 0.1 CPU / 750 hr/mo | scheduler + 10 bot subprocesses near OOM. Drop `MATCHES_PER_CYCLE` if needed. |
| Neon free | 0.5 GB / autosuspend | replays are JSONB ~30 KB/match → ~16k matches before full. |
| UptimeRobot free | 50 monitors | n/a |
| Google OAuth | unlimited | n/a |

If you outgrow free: **Render Starter $7/mo** (no sleep, more RAM) requires zero code change.
