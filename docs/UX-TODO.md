# UI / UX improvements — backlog

Concrete, scoped items found from auditing the live pages. Each has a
clear acceptance criterion so they're shippable as small PRs.

---

## 1. Replace `alert()` with a toast component
**Where**: `/admin/training`, `/admin/data`, `BotEditor`, `/bots delete-button`, `/matches/new`
**Why**: Native `alert()` blocks the page and looks broken on mobile.
**Acceptance**: A small `<Toast />` component (top-right, auto-dismiss 4 s,
red for error / green for success). `useToast()` hook with push/dismiss.
Migrate every `globalThis.alert(...)` call.
**Effort**: ~1 h.

---

## 2. Empty-state cards on list pages
**Where**: `/bots`, `/matches`, `/admin/training`, `/admin/data`, `/leaderboard`
**Why**: Empty tables look broken. Some pages already have one-off prose
("No bots yet — clone a sample"); standardize.
**Acceptance**: New `<EmptyState icon title body cta />` component.
Render it whenever the data array is `[]`. CTA button links to the most
useful next page.
**Effort**: ~30 min.

---

## 3. Relative timestamps everywhere
**Where**: `/matches`, `/bots`, `/admin/data`, `/replay` "tick when"
**Why**: `m.createdAt.toLocaleString()` shows "4/27/2026, 11:46:21 AM"
which is dense and not what users care about. They want "3 min ago".
**Acceptance**: Tiny helper `formatRelative(date)` returning `"32s ago"`,
`"4m ago"`, `"2h ago"`, `"3d ago"`. On hover, `<time title="full ISO">`
shows the absolute time.
**Effort**: ~20 min, no deps.

---

## 4. Trainer report visible in admin UI
**Where**: New tab on `/admin/training` or new page `/admin/training/report`
**Why**: Hourly digest currently only goes to `console.log`. Admin can't
read it without `render logs --tail`.
**Acceptance**: Persist trainer reports to a new `trainer_reports` table
(bot_id, period_start, matches, wins, promotions, baseline_start,
baseline_end, sigma_start, sigma_end). Render a sparkline + table on the
admin page showing the last 24 reports per trainee bot.
**Effort**: ~2 h (schema + persistence + UI).

---

## 5. Mobile-friendly header
**Where**: `apps/web/src/app/layout.tsx`, `globals.css`
**Why**: Header has 6+ links + admin nav + user pill + signout. On a
phone the bar wraps awkwardly or hides the brand.
**Acceptance**: Below 768 px, collapse "My bots / Samples / Matches /
Leaderboard" into a hamburger menu. Brand + sign-in stay visible.
**Effort**: ~45 min.

---

## 6. Keyboard shortcuts in `ReplayViewer`
**Where**: `apps/web/src/components/ReplayViewer.tsx`
**Why**: Watching a 900-tick replay tick-by-tick currently means
clicking the slider or pressing the next button. Power-users want
keys.
**Acceptance**:
- `Space` → play/pause
- `←` / `→` → -1 / +1 tick
- `Shift+←` / `Shift+→` → -10 / +10 ticks
- `Home` / `End` → first / last tick
- `F` → toggle fog of war
- `?` → show overlay listing the shortcuts
**Effort**: ~30 min.

---

## 7. Search / filter on `/admin/training`
**Where**: `apps/web/src/app/admin/training/client.tsx`
**Why**: With 50+ bots the table becomes unscannable.
**Acceptance**:
- Text input that filters by name (case-insensitive).
- Toggle "Show training only" / "Show all".
- "Sort by win%" / "Sort by matches" buttons (default already win%).
- All client-side filtering — no extra API calls.
**Effort**: ~30 min.

---

## 8. Inline bot helpers in the editor
**Where**: `apps/web/src/components/BotEditor.tsx` (Monaco)
**Why**: Helper globals (`DIRS`, `canMove`, `nearestBot`, `leadShot`, …)
are defined in the harness but Monaco shows them as undefined / red
squiggles. Authors are guessing.
**Acceptance**: Provide a `lib.d.ts` snippet via
`monaco.languages.typescript.javascriptDefaults.addExtraLib(...)` listing
every helper and its signature. Pull autocomplete + hover docs.
The d.ts is auto-generated from `bots/runtime/harness.js` JSDoc by a
`bun scripts/gen-helper-types.ts` script (run on build).
**Effort**: ~2 h (parse JSDoc + emit d.ts + wire into Monaco).

---

## 9. Win/loss icons + rating delta on `/matches` rows
**Where**: `apps/web/src/app/matches/page.tsx`
**Why**: Current row shows ID-Kind-Status-When-Replay. To find the
match where YOUR bot won, you have to click in.
**Acceptance**: When viewer is signed in, add a column "My result"
showing 🏆 (1st) / 🥈 (top 3) / 💀 (eliminated) / "—" (not in this
match), plus the user's `rating_delta` (`+12.4` green / `−8.1` red).
**Effort**: ~45 min (needs a `matchesByUser` repo method).

---

## 10. Make the `Params` download UX a real button
**Where**: `apps/web/src/app/admin/training/client.tsx`
**Why**: Two tiny `<a download>` links labelled `⇩ latest` and
`history`. Looks like an afterthought next to a primary "Stop training"
button. Users miss it.
**Acceptance**: Single dropdown button (`Download ▾`) with menu items:
- "Latest params (v77)"
- "Last 20 versions"
- "All versions"
- separator
- "Copy bot UUID to clipboard"
Use a tiny popover (no UI lib) — `<details>`+`<summary>` works without
JS state.
**Effort**: ~30 min.

---

## Total effort: ~8 h to clear all 10. Most can ship as a single PR.
