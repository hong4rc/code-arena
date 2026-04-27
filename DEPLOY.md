# Code Arena — Deployment Guide (Free Tier, No Credit Card)

This deploy uses **only free services that don't ask for a credit card**:

| Layer | Service | Free tier | CC required? |
|---|---|---|---|
| App host (Docker container) | **Render** Web Service (free plan) | 512 MB RAM, 0.1 CPU | ❌ No |
| Database + Auth | **Supabase** | 500 MB Postgres, Google OAuth, 50k MAU | ❌ No |
| OAuth provider | **Google Cloud** | unlimited free | ❌ No |
| Keep-alive pinger | **UptimeRobot** | 50 monitors, 5-min interval | ❌ No |

Total monthly cost: **$0**.

**Caveat (be honest with yourself):** Render's free Web Service sleeps after 15 minutes of zero traffic, which would stall the matchmaking scheduler. We solve that with a free uptime pinger. Cold start after sleep is ~30 seconds.

---

## 1. Accounts to create (in order)

1. **Google Cloud** — for OAuth → <https://console.cloud.google.com> (no CC; the free OAuth client costs nothing)
2. **Supabase** — <https://supabase.com> (no CC for Free plan)
3. **GitHub** — Render reads your code from a repo, so you'll push there
4. **Render** — <https://render.com> (no CC for Free plan)
5. **UptimeRobot** — <https://uptimerobot.com> (no CC, free 50 monitors) — set up in Step 7

---

## 2. Push the repo to GitHub

Render needs a git repo to deploy from.

```sh
cd /Users/anhhong/project/api/ai/game-serve
git add -A
git commit -m "initial: bot arena scaffold"
gh repo create code-arena --public --source=. --push
# or manually create on github.com and:
#   git remote add origin git@github.com:YOU/code-arena.git
#   git push -u origin main
```

---

## 3. Set up Supabase (Postgres + Google OAuth)

### 3.1 Create the project
1. <https://supabase.com/dashboard> → **New project**.
2. Name: `code-arena`. Region: nearest to your Render region (e.g. Singapore for `singapore`).
3. Pick a strong DB password — **save it**.
4. Wait ~2 min for provisioning.

### 3.2 Grab connection details
**Project Settings → API**:
- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role secret` key → `SUPABASE_SERVICE_ROLE_KEY` (server only — never ship to browser)

**Project Settings → Database → Connection string**:
- For **migrations** (run from your laptop): use the **direct** URI (`db.YOUR-PROJECT.supabase.co:5432`).
- For **runtime** (Render): use the **transaction-mode pooler** URI (`pooler.supabase.com:6543`) — handles many short-lived connections; required for Render's connection patterns.

Both look like `postgresql://postgres.xxx:PASSWORD@HOST:PORT/postgres`.

### 3.3 Set up Google OAuth (do Google Cloud first, then Supabase)

**Google Cloud Console** → **APIs & Services → Credentials** → **Create Credentials → OAuth client ID**:
- App type: **Web application**
- Name: `Code Arena`
- Authorized redirect URIs (add **both**):
  - `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
  - `https://YOUR-RENDER-APP.onrender.com/auth/callback` (you'll know this URL after Step 4)
- Click **Create** → copy **Client ID** and **Client secret**

**Supabase → Authentication → Providers → Google**: enable, paste Client ID + Secret, **Save**.

**Supabase → Authentication → URL Configuration**:
- Site URL: `https://YOUR-RENDER-APP.onrender.com`
- Redirect URLs (add): `https://YOUR-RENDER-APP.onrender.com/**`

You can come back and update these URLs after Render gives you the actual hostname in Step 4.

---

## 4. Deploy to Render

### 4.1 Create the service
1. <https://dashboard.render.com> → **New + → Blueprint**.
2. Connect your GitHub repo. Render reads `render.yaml` and previews one Web Service.
3. Click **Apply**.
4. Render builds the Dockerfile (compiles nsjail from source — first build takes ~5–8 min, subsequent builds use cache and take ~1 min).

### 4.2 Get your hostname
After the first deploy, Render shows a URL like `https://code-arena.onrender.com`. **Update Supabase + Google OAuth redirect URLs to use this** (Step 3.3).

### 4.3 Set environment variables
**Render dashboard → code-arena → Environment**:
- `DATABASE_URL` → the **pooler** connection string from Supabase (port 6543)
- `NEXT_PUBLIC_SUPABASE_URL` → from Supabase
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` → from Supabase
- `SUPABASE_SERVICE_ROLE_KEY` → from Supabase

Render auto-redeploys when you save env vars.

---

## 5. Run migrations + seed (from your laptop)

Use the **direct** Supabase URL for DDL (the pooler doesn't support some schema operations).

```sh
# Set the direct URL (port 5432, db.YOUR-PROJECT.supabase.co)
export DATABASE_URL='postgresql://postgres:PASSWORD@db.YOUR-PROJECT.supabase.co:5432/postgres'

bun install --frozen-lockfile

cd packages/db
bun run migrate          # creates tables
cd ../..
bun packages/db/src/seed.ts   # adds system user, Season 1, 4 sample bots
```

Verify in **Supabase → Table Editor**:
- `users` has 1 row (system user)
- `seasons` has 1 row marked `is_active`
- `bots` has 4 rows marked `is_official=true`

---

## 6. First sign-in + admin

1. Open your Render URL → **Sign in with Google**.
2. Land on `/bots` (empty list).
3. Promote yourself to admin via Supabase **SQL Editor**:
   ```sql
   UPDATE users SET role = 'admin' WHERE email = 'YOU@example.com';
   ```

---

## 7. Set up the keep-alive pinger (critical for free tier)

Render's free Web Service sleeps after 15 minutes with zero traffic. We hit `/api/health` every 5 minutes from outside Render to keep it warm.

### Easiest: UptimeRobot (free, no CC, 5-min interval)
1. <https://uptimerobot.com> → sign up.
2. **+ Add New Monitor**:
   - Type: **HTTPS**
   - Name: `code-arena keep-alive`
   - URL: `https://YOUR-RENDER-APP.onrender.com/api/health`
   - Interval: **5 minutes**
3. Save. UptimeRobot now hits the URL every 5 min, which is enough to prevent sleep.

### Bonus benefit
You also get free uptime monitoring + email/Slack alerts when the app goes down.

### Alternatives (also free, no CC)
- **cron-job.org** — schedule HTTP GETs every 5–10 min
- **GitHub Actions cron** — add `.github/workflows/ping.yml`:
  ```yaml
  on:
    schedule: [{ cron: "*/10 * * * *" }]
  jobs:
    ping:
      runs-on: ubuntu-latest
      steps:
        - run: curl -fsS https://YOUR-RENDER-APP.onrender.com/api/health
  ```

---

## 8. Smoke test

1. Sign in (Google OAuth) → `/bots`.
2. Visit `/samples` → click **Clone** on `greedy-bot` → land in editor.
3. Hit **Save** → validation runs; no errors → bot is runnable.
4. Repeat 4–5 more clones (the matchmaker needs ≥ 20 active bots before it'll create a match).
5. Open `/matches` and wait up to 5 minutes. When a match enters `running` status, click **Watch live →** to see ticks stream in over WebSocket on the canvas.

If the matchmaker isn't picking up after enough bots are cloned, check **Render logs** for `[scheduler]` messages.

---

## 9. Day-to-day

### Deploy a code change
```sh
git push   # Render auto-deploys (set in render.yaml)
```

### Tail logs
**Render dashboard → code-arena → Logs**, or via the CLI:
```sh
brew install render
render login
render logs code-arena --tail
```

### Run a migration after a schema change
```sh
cd packages/db
bun run generate           # writes a new SQL file under drizzle/
git add drizzle && git commit -m "schema: …" && git push
# Migrations DON'T auto-run on Render — apply manually:
export DATABASE_URL='direct supabase URL'
bun run migrate
```

### Re-seed (idempotent — safe to re-run)
```sh
bun packages/db/src/seed.ts
```

---

## 10. Environment variable reference

| Var | Where | Value |
|---|---|---|
| `DATABASE_URL` | Render env | Supabase **pooler** URL (port 6543) |
| `NEXT_PUBLIC_SUPABASE_URL` | Render env | `https://YOUR-PROJECT.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Render env | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Render env | Supabase service role key (admin) |
| `NODE_ENV` | render.yaml | `production` |
| `PORT` | render.yaml | `3000` |
| `DISABLE_BACKGROUND` | optional | Set to `1` to disable scheduler/runner (e.g. CI) |

For local dev, copy `.env.example` to `.env` next to `apps/web/server.ts`:
```sh
cd apps/web && cp ../../.env.example .env
# fill values
bun run dev
```

---

## 11. About sandboxing on Render free

Render runs your container in a Linux namespace. The Dockerfile builds `nsjail` and uses it to wrap each bot subprocess (32 MB memory cap, no network, read-only FS, dropped capabilities, non-root UID, 20 s wall time).

**Reality check**: Render's host kernel may or may not allow the unprivileged user-namespace tricks nsjail uses. The runner code (`packages/runner/src/nsjail.ts`) checks if `/usr/local/bin/nsjail` is present and falls back to a plain `bun <bot.js>` subprocess if not.

In the fallback case (no nsjail), you still have:
- AST denylist at upload (rejects all imports, `eval`, `Function`, dynamic imports — bots are single-file).
- Per-tick wall timeout (kills runaway bots after 300 ms).
- Subprocess isolation (no shared state with the main server).
- Bun heap cap on the bot process (set via `--max-old-space-size`).

That's "good enough for friends and learning" but **not production-grade**. If you ever open this to truly untrusted internet traffic, upgrade off the free tier and run on a host where you control kernel sysctls (`kernel.unprivileged_userns_clone=1`), or move bots to WebAssembly.

---

## 12. Costs and limits

| Resource | Free | Hits limit when |
|---|---|---|
| Render Web Service free | 512 MB RAM / 0.1 CPU / 750 hr/mo | scheduler + WS + 10 bot subprocesses → near the RAM ceiling. If you OOM, drop `MATCHES_PER_CYCLE` to 1 or `MATCH_SIZE` to 6. |
| Supabase free | 500 MB DB / 50k MAU | Replays are JSONB; budget ~30 KB/match. ~16k matches before you fill 500 MB. |
| UptimeRobot free | 50 monitors, 5-min interval | n/a |
| Google OAuth | unlimited | n/a |

If you outgrow free: Render Starter ($7/mo, no sleep, more RAM/CPU) is the cheapest upgrade and needs zero code change.

---

## 13. Troubleshooting

| Symptom | Likely cause |
|---|---|
| App sleeps despite UptimeRobot | Verify the monitor URL hits `/api/health` and returns 200. Check UptimeRobot dashboard for "down" entries. |
| Sign-in lands on a Supabase error page | Site URL or redirect URLs in Supabase → Authentication → URL Configuration don't match your Render hostname. Update both, sign out, retry. |
| Build fails on `nsjail` step | Render's free build minutes can be slow; rerun. If nsjail keeps failing, comment out the `nsjail-builder` stage in Dockerfile — the runner falls back to non-jailed subprocesses. |
| `DATABASE_URL not set` in Render logs | You forgot Step 4.3, or you set it in render.yaml's `value:` field instead of in the dashboard. Use the dashboard for secrets. |
| Scheduler logs `only N bots — need 20` | Clone more samples; matchmaker waits for ≥ 20 runnable bots. |
| Bot saves succeed but match never starts | Open Render logs and look for `[runner pump]` errors — likely a Supabase pooler connection issue. Switch `DATABASE_URL` to direct URL temporarily to test. |
| WebSocket disconnects often | Render free terminates idle WS at ~60 s. With our 700 ms tick floor a 10-tick match is ~7 s, fine. Reconnects only happen on cold-start wake-up. |

---

## 14. What's not in V1 (intentional follow-ups)

These are coded as TODO stubs — schema and code paths support them, just no UI yet:

- **Admin panel** for seasons / config tuning (insert via SQL works today).
- **Sim worker** running matches against `sim.*` schema for balance testing.
- **Custom-match UI** (data model supports it; insert via SQL today).
- **Per-bot data export** endpoint (`GET /api/bots/:id/export?format=csv|json`).
- **20-bot sample family** (4 ship today; pattern is mechanical to extend).

When you build any of these, no schema changes needed.
