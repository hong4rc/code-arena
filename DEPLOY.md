# Code Arena — Deploy Guide

Free tier, no credit card. **~30 min from zero to live URL.**

| Layer | Service | Free quota | CC? |
|---|---|---|---|
| App container | Render web service | 512 MB / 750 hr | ❌ |
| Postgres | Neon | 0.5 GB | ❌ |
| OAuth | Google Cloud | unlimited | ❌ |
| Anti-sleep ping | UptimeRobot | 50 monitors | ❌ |

> **The plan**: build up `apps/web/.env` as you go. At Render time, paste that whole file into Render's "Add from .env" dialog. Same file works for local dev.

---

## Step 1 — Push to GitHub

```sh
git push
```

---

## Step 2 — Create the `.env` skeleton with the secret already filled

From the repo root:

```sh
mkdir -p apps/web
cat > apps/web/.env <<EOF
DATABASE_URL=
AUTH_SECRET=$(openssl rand -base64 32)
AUTH_URL=https://REPLACE-WITH-RENDER-URL.onrender.com
NEXT_PUBLIC_APP_URL=https://REPLACE-WITH-RENDER-URL.onrender.com
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
EOF
```

`AUTH_SECRET` is now a 32-byte random string. The other values you'll fill in below.

> **Note**: `apps/web/.env` is gitignored — never commit it.

---

## Step 3 — Neon (DATABASE_URL)

1. <https://console.neon.tech> → sign up with GitHub.
2. **New project** → name `code-arena`, region nearest you.
3. After provisioning, the dashboard shows a **Connection string**. Click the copy icon.
4. Paste it into `apps/web/.env` after `DATABASE_URL=`.

After this step the line should look like:
```
DATABASE_URL=postgresql://USER:PASS@ep-xxx.us-east-2.aws.neon.tech/code_arena?sslmode=require
```

---

## Step 4 — Google Cloud OAuth (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)

1. <https://console.cloud.google.com> → top bar project picker → **NEW PROJECT** → name `code-arena` → **CREATE** → select it.
2. Sidebar (☰) → **APIs & Services → OAuth consent screen** → **Get started**:
   - App name: `Code Arena`
   - User support email + Developer email: yours
   - Audience: **External**
   - Save and skip the rest.
3. Sidebar → **APIs & Services → Credentials → + CREATE CREDENTIALS → OAuth client ID**.
4. Application type: **Web application**. Name: `Code Arena web`.
5. **Authorized JavaScript origins** → click **+ ADD URI** twice:
   - `http://localhost:3000`
   - `https://REPLACE-WITH-RENDER-URL.onrender.com`
   *(no trailing slash, no path)*
6. **Authorized redirect URIs** → click **+ ADD URI** twice:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://REPLACE-WITH-RENDER-URL.onrender.com/api/auth/callback/google`
7. **CREATE** → popup shows Client ID + Client secret.
8. Paste both into `apps/web/.env`:
   ```
   GOOGLE_CLIENT_ID=<paste>
   GOOGLE_CLIENT_SECRET=<paste>
   ```

(You'll come back to fix the Render URL placeholders after Step 5.)

---

## Step 5 — Render (deploy)

1. <https://dashboard.render.com> → sign up with GitHub.
2. **+ New → Blueprint** → pick `hong4rc/code-arena` → **Apply**.
3. Wait 5–8 min for the first build.
4. When status shows **Live**, copy the URL it gave you (e.g. `https://code-arena-xxxx.onrender.com`).
5. Update `apps/web/.env` — replace **both** `REPLACE-WITH-RENDER-URL` strings with this real URL:
   ```sh
   sed -i '' 's|https://REPLACE-WITH-RENDER-URL.onrender.com|https://code-arena-xxxx.onrender.com|g' apps/web/.env
   ```
   *(macOS — for Linux drop the `''` after `-i`)*
6. **Back to Google Cloud** → Credentials → Code Arena web. Replace the `REPLACE-WITH-RENDER-URL` placeholder in **both** fields with your real Render hostname:
   - **Authorized JavaScript origins** → second entry
   - **Authorized redirect URIs** → second entry

   Click **SAVE**.

---

## Step 6 — Push your `.env` into Render

Render's dashboard has a bulk-paste feature.

1. Render dashboard → **code-arena → Environment** tab.
2. Click **Add from .env**.
3. Open `apps/web/.env`, copy the entire contents, paste into the dialog.
4. **Save Changes**. Render auto-redeploys (~1 min).

---

## Step 7 — Run migrations + seed

From your terminal in the repo root:

```sh
set -a && source apps/web/.env && set +a
bun install --frozen-lockfile

cd packages/db && bun run migrate && cd ../..
bun packages/db/src/seed.ts
```

You should see `created system user`, `created Season 1`, and 4 `seeded *-bot` lines.

---

## Step 8 — First sign-in + make yourself admin

1. Open your Render URL → **Sign in** → Google flow → land on `/bots`.
2. Neon dashboard → **SQL Editor** → run:
   ```sql
   UPDATE users SET role = 'admin' WHERE email = 'YOU@example.com';
   ```

---

## Step 9 — Anti-sleep pinger

1. <https://uptimerobot.com> → **Sign Up Free**.
2. **+ Add New Monitor**:
   - Type: **HTTPS**
   - Name: `code-arena keep-alive`
   - URL: `https://YOUR-RENDER-URL.onrender.com/api/health`
   - Interval: **5 minutes**
3. **Create Monitor**.

---

## Step 10 — Smoke test

1. `/samples` → **Clone** the `greedy-bot` card → editor opens. **Save**.
2. Repeat 19 more times (matchmaker needs ≥ 20 active bots) — or shortcut via Neon SQL:
   ```sql
   WITH m AS (
     INSERT INTO matches (season_id, kind, status, seed)
     SELECT id, 'custom', 'pending', floor(random()*1000000)::int
     FROM seasons WHERE is_active LIMIT 1
     RETURNING id
   )
   INSERT INTO match_participants (match_id, bot_id, bot_version_id)
   SELECT m.id, b.id, b.current_version_id FROM m, bots b WHERE b.is_official LIMIT 4;
   ```
3. `/matches` → wait up to 5 min → click **Watch live →** when one is `running`.

---

## Local development

You already have everything you need — `apps/web/.env` works locally too. Just override the URLs:

```sh
cd apps/web
sed -i '' 's|https://code-arena.*onrender.com|http://localhost:3000|g' .env
bun run dev    # http://localhost:3000
```

Run a match without a DB:

```sh
bun scripts/local-match.ts \
  --bots bots/samples/greedy-bot.js,bots/samples/hunter-bot.js,bots/samples/defensive-bot.js \
  --seed 42 --ticks 10
```

---

## Day-2 ops

**Deploy a code change**
```sh
git push    # Render auto-deploys
```

**Apply a new migration**
```sh
cd packages/db && bun run generate    # writes new SQL under drizzle/
git add . && git commit -m "schema: …" && git push

# then apply against Neon:
set -a && source ../../apps/web/.env && set +a
bun run migrate
```

**Tail logs** — Render dashboard → code-arena → **Logs**.

---

## Env var reference

| Variable | Where it lives | What it is |
|---|---|---|
| `DATABASE_URL` | `apps/web/.env` + Render env | Neon connection string |
| `AUTH_SECRET` | `apps/web/.env` + Render env | `openssl rand -base64 32` (Step 2) |
| `AUTH_URL` | `apps/web/.env` + Render env | Public app URL — Render hostname in prod, `http://localhost:3000` in dev |
| `NEXT_PUBLIC_APP_URL` | `apps/web/.env` + Render env | Same as `AUTH_URL` |
| `GOOGLE_CLIENT_ID` | `apps/web/.env` + Render env | Google Cloud → Credentials |
| `GOOGLE_CLIENT_SECRET` | `apps/web/.env` + Render env | Google Cloud → Credentials |
| `NODE_ENV` | `render.yaml` (auto) | `production` |
| `PORT` | `render.yaml` (auto) | `3000` |
| `DISABLE_BACKGROUND` | optional Render env | `1` to disable scheduler/runner |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `redirect_uri_mismatch` from Google | Google Cloud → Credentials → Code Arena web. The redirect URI must be `https://YOUR-REAL-URL.onrender.com/api/auth/callback/google` — character-perfect. |
| Sign-in succeeds but lands on 404 | `AUTH_URL` in Render env doesn't match your real URL. Update + redeploy. |
| App goes to sleep | UptimeRobot dashboard → confirm monitor shows green every 5 min. |
| `Next.js build worker exited with code: 1` | OOM on Render free 512 MB. The Dockerfile already caps V8 heap at 400 MB; if it still OOMs, drop `--ticks` in any local jobs and try **Manual Deploy → Deploy latest commit**. |
| Trainer logs spam | Set `DISABLE_TRAINER=1` on the Render service env to keep matches but skip evolution. |
| `is_training_target` column missing | Last migration didn't apply. From local: `set -a; source .env; set +a; cd packages/db && bun run migrate` against the same Neon DB. |
| `DATABASE_URL not set` in Render logs | Step 6 didn't take. Re-paste `apps/web/.env` into Render's bulk-add. |
| Scheduler logs `only N bots — need 20` | Clone more samples, or insert via the SQL in Step 10. |

---

## Costs at a glance

| Resource | Free | Hits limit when |
|---|---|---|
| Render free | 512 MB / 0.1 CPU / 750 hr | 10 bot subprocesses near OOM. Drop `SCHEDULE_MATCH_SIZE`, or `DISABLE_TRAINER=1` to free RAM. |
| Neon free | 0.5 GB / autosuspend | replays ~30 KB/match → ~16k matches before full. |
| UptimeRobot | 50 monitors | n/a |
| Google OAuth | unlimited | n/a |

Outgrow free → **Render Starter $7/mo** (no sleep, more RAM) — zero code change.
