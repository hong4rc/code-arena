# Code Arena — Deployment Guide (Free Tier, No Credit Card)

Stack:

| Layer | Service | Free tier | Credit card? |
|---|---|---|---|
| App container (Docker) | **Render** Web Service | 512 MB / 0.1 CPU / 750 hr/mo | ❌ No |
| Postgres database | **Neon** | 0.5 GB / autosuspend | ❌ No |
| Google OAuth | **Google Cloud** | unlimited free | ❌ No |
| Keep-alive ping | **UptimeRobot** | 50 monitors / 5-min interval | ❌ No |

Total monthly cost: **$0**.

**Caveat to be honest about**: Render's free Web Service sleeps after 15 minutes of zero traffic, which would stall the matchmaking scheduler. We solve that with the UptimeRobot ping in step 7.

---

## 1. Accounts to create (in order)

1. **Google Cloud** → <https://console.cloud.google.com> (no CC for OAuth)
2. **Neon** → <https://neon.tech> (no CC for Free plan)
3. **GitHub** → Render reads your repo, so push it there
4. **Render** → <https://render.com> (no CC for Free plan)
5. **UptimeRobot** → <https://uptimerobot.com> (free 50 monitors)

---

## 2. Push the repo to GitHub

```sh
cd /Users/anhhong/project/api/ai/game-serve
git remote -v   # already configured if you followed earlier steps
git push        # if there's anything new
```

---

## 3. Create Neon Postgres

1. <https://console.neon.tech> → **New project**.
2. Project name: `code-arena`. Region: nearest your Render region.
3. Database name: `code_arena`. Click **Create**.
4. Copy the **connection string** shown — looks like:
   `postgresql://user:password@ep-xxx-yyy.us-east-2.aws.neon.tech/code_arena?sslmode=require`
5. Save it as your `DATABASE_URL`.

> Neon's free tier has no separate "pooler" URL — the same string works for both runtime and migrations. Easier than Supabase.

---

## 4. Create Google OAuth client

You're creating one Web client used directly by Code Arena. **No third-party in the OAuth flow.**

### 4.1 Create / select a project
1. <https://console.cloud.google.com> → top-bar project picker → **New Project** → name `code-arena` → **Create**.
2. Select the new project.

### 4.2 Configure the OAuth consent screen (one time per project)
You can't create an OAuth client until this is done.

1. Sidebar (≡) → **APIs & Services** → **OAuth consent screen**.
2. **Get started** if shown.
3. Fill:
   - **App name**: `Code Arena`
   - **User support email**: your email
   - **Audience** / **User type**: **External**
   - **Developer contact**: your email
4. **Save and continue** through the rest. Skip Scopes and Test Users.

### 4.3 Create the OAuth client
1. Sidebar → **APIs & Services** → **Credentials**.
2. **+ Create Credentials → OAuth client ID**.
3. **Application type**: `Web application`.
4. **Name**: `Code Arena web`.
5. **Authorized JavaScript origins** — add **only your own domains**:
   - `http://localhost:3000` (for local dev)
   - `https://code-arena.onrender.com` (after Render gives you the URL — come back and add it later)
6. **Authorized redirect URIs**:
   - `http://localhost:3000/api/auth/callback/google` (local dev)
   - `https://code-arena.onrender.com/api/auth/callback/google` (production)
7. **Create**. A modal shows **Client ID** and **Client Secret** — copy both now (the secret is hidden after you close it).

> Notice there's no `supabase.co` anywhere. The OAuth flow goes browser → Google → your app, with nothing in between.

---

## 5. Run migrations + seed (from your laptop)

```sh
export DATABASE_URL='postgresql://USER:PASS@ep-xxx.us-east-2.aws.neon.tech/code_arena?sslmode=require'

bun install --frozen-lockfile
cd packages/db
bun run migrate          # creates all tables
cd ../..
bun packages/db/src/seed.ts   # adds system user, Season 1, 4 sample bots
```

Verify in Neon's **SQL Editor**:
```sql
SELECT id, email, role FROM users;
SELECT id, name, is_official FROM bots WHERE is_official = true;
SELECT name, is_active FROM seasons;
```
You should see 1 system user, 4 official bots, and 1 active "Season 1".

---

## 6. Deploy to Render

### 6.1 Create the service
1. <https://dashboard.render.com> → **New + → Blueprint**.
2. Connect your GitHub repo. Render reads `render.yaml` and previews the Web Service.
3. **Apply**.
4. First build takes ~5–8 min (compiles `nsjail` from source). Subsequent builds are cached.

### 6.2 Get your hostname
After deploy, Render shows a URL like `https://code-arena.onrender.com`. **Now go back to Google Cloud Credentials (step 4.3)** and add this URL to both **Authorized JavaScript origins** and **Authorized redirect URIs** (`https://code-arena.onrender.com/api/auth/callback/google`).

### 6.3 Set environment variables
**Render dashboard → code-arena → Environment**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon connection string (step 3.4) |
| `AUTH_SECRET` | Generate with `openssl rand -base64 32` |
| `AUTH_URL` | `https://code-arena.onrender.com` |
| `NEXT_PUBLIC_APP_URL` | `https://code-arena.onrender.com` |
| `GOOGLE_CLIENT_ID` | from step 4.3 |
| `GOOGLE_CLIENT_SECRET` | from step 4.3 |

Render auto-redeploys when you save. Wait for it to finish.

---

## 7. Set up the keep-alive pinger (critical for free tier)

Render free sleeps after 15 min of zero traffic. UptimeRobot pings `/api/health` every 5 min to keep it warm.

1. <https://uptimerobot.com> → sign up.
2. **+ Add New Monitor**:
   - Type: **HTTPS**
   - Name: `code-arena keep-alive`
   - URL: `https://code-arena.onrender.com/api/health`
   - Interval: **5 minutes**
3. Save.

Free uptime alerts come included.

---

## 8. First sign-in + admin promotion

1. Open `https://code-arena.onrender.com` → **Sign in** → Google flow.
2. After redirect, you land on `/bots` (empty list).
3. Promote yourself to admin via Neon **SQL Editor**:
   ```sql
   UPDATE users SET role = 'admin' WHERE email = 'YOU@example.com';
   ```

---

## 9. Smoke test

1. Visit `/samples` → **Clone** the `greedy-bot` card → land in editor.
2. **Save** → validation runs (acorn AST + smoke run subprocess) → bot becomes runnable.
3. Repeat 4–5 more clones; the matchmaker needs ≥ 20 active bots before it'll create a match. (Or insert a custom match via SQL — see Day-2 ops below.)
4. Open `/matches`. When a match enters `running`, click **Watch live →** for the WebSocket-streamed canvas.

---

## 10. Day-2 operations

### Deploy a code change
```sh
git push   # Render auto-redeploys
```

### Run a migration after a schema change
```sh
cd packages/db
bun run generate       # writes a new SQL file under drizzle/
git add drizzle && git commit -m "schema: …" && git push
# Apply manually against Neon:
export DATABASE_URL='...'
bun run migrate
```

### Tail logs
**Render dashboard → code-arena → Logs** — or use the CLI: `brew install render && render login && render logs code-arena --tail`.

### Insert a custom match (until the admin UI ships)
```sql
-- pick 10 of YOUR bot ids
WITH match AS (
  INSERT INTO matches (season_id, kind, status, seed)
  SELECT id, 'custom', 'pending', floor(random()*1000000)::int FROM seasons WHERE is_active LIMIT 1
  RETURNING id, season_id
)
INSERT INTO match_participants (match_id, bot_id, bot_version_id)
SELECT match.id, b.id, b.current_version_id
FROM match, bots b
WHERE b.is_official = true
LIMIT 10;
```

---

## 11. Environment variable reference

| Var | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Render env | Neon connection string |
| `AUTH_SECRET` | Render env | Better Auth signing key (`openssl rand -base64 32`) |
| `AUTH_URL` | Render env | Public URL of the app — used for OAuth callbacks |
| `NEXT_PUBLIC_APP_URL` | Render env | Same as AUTH_URL; readable from the browser |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Render env | Google OAuth credentials |
| `NODE_ENV` | render.yaml | `production` |
| `PORT` | render.yaml | `3000` |
| `DISABLE_BACKGROUND` | optional | Set to `1` to disable scheduler (CI builds) |

For local dev:
```sh
cp .env.example apps/web/.env
# fill values; AUTH_URL = http://localhost:3000
cd apps/web && bun run dev
```

---

## 12. About sandboxing on Render free

Render runs your container in a Linux namespace. The Dockerfile builds `nsjail` and the runner uses it to wrap each bot subprocess (32 MB memory, no network, dropped capabilities, 20 s wall time).

**Reality check**: Render's host kernel may or may not allow nsjail's unprivileged user-namespace tricks. The runner code falls back to a plain `bun bot.js` subprocess if nsjail fails to invoke. In the fallback case you still have:

- AST denylist at upload (rejects all imports, `eval`, `Function`, dynamic imports).
- Per-tick wall timeout (300 ms).
- Subprocess isolation (no shared memory).

That's "good enough for friends and learning" but **not production-grade for hostile traffic**. If you ever open this to truly untrusted internet, upgrade to a host where you control kernel sysctls or move bots to WebAssembly.

---

## 13. Costs and limits

| Resource | Free | Hits limit when |
|---|---|---|
| Render Web Service free | 512 MB / 0.1 CPU / 750 hr | Scheduler + WS + 10 bot subprocesses can flirt with the RAM ceiling. If you OOM, drop `MATCHES_PER_CYCLE` to 1 in `apps/web/src/server/scheduler.ts`. |
| Neon free | 0.5 GB / autosuspend | Replays are JSONB ~30 KB/match → ~16k matches before the DB fills. |
| UptimeRobot | 50 monitors | n/a |
| Google OAuth | unlimited | n/a |

If you outgrow free: Render Starter ($7/mo, no sleep, more RAM) requires zero code change.

---

## 14. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Sign-in redirects to a Google "redirect_uri_mismatch" error | The redirect URI in Google Cloud Credentials doesn't match exactly. Must be `https://code-arena.onrender.com/api/auth/callback/google` — protocol, host, path all character-perfect. |
| Sign-in succeeds but lands on a 404 | `AUTH_URL` env var doesn't match your real URL, so Better Auth redirects to the wrong host. Fix `AUTH_URL` and redeploy. |
| App sleeps despite UptimeRobot | Verify the monitor URL hits `/api/health` and returns 200 in UptimeRobot's dashboard. |
| Build fails on `nsjail` step | Render free build minutes can be slow — rerun. If it keeps failing, you can comment out the `nsjail-builder` stage in Dockerfile; the runner falls back to non-jailed subprocesses. |
| `DATABASE_URL not set` in Render logs | You forgot step 6.3, or you put it in `render.yaml`'s `value:` field. Use the dashboard for secrets. |
| Scheduler logs `only N bots — need 20` | Clone more samples. The matchmaker waits for ≥ 20 runnable bots. |
| WebSocket disconnects often | Render free terminates idle WS at ~60 s. With our 700 ms tick floor a 10-tick match is ~7 s — fine. Cold-start wake-ups will reconnect once. |

---

## 15. What's not in V1 (intentional follow-ups)

These are coded as TODOs — the data model and code paths support them:

- **Admin panel** for seasons / config tuning (insert via SQL today).
- **Sim worker** running matches against `sim.*` schema for balance testing.
- **Custom-match UI** (data model supports it).
- **Per-bot data export** endpoint.
- **20-bot sample family** (4 ship today; mechanical to extend).

When you build any of these, no schema changes needed.
