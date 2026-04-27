/* eslint-disable no-console */
// Dump a single match's per-tick action log + bot positions in compact form.
// Usage:
//   bun run packages/db/src/debug-match.ts <matchId>
// Or:
//   cd packages/db && bun src/debug-match.ts 019dce1c-9bc7-77c9-a819-b70dec08f60c
import { eq, inArray } from "drizzle-orm";

import { getDb } from "./index.ts";
import { bots, matchParticipants, matchReplays, matches } from "./schema.ts";

interface ResolvedAction {
  botId: string;
  attempted: { type: string; dir?: string; target?: { dx: number; dy: number }; item?: string };
  applied:   { type: string; dir?: string; target?: { dx: number; dy: number }; item?: string };
  reason?: string;
}
interface BotSnap { id: string; x: number; y: number; hp: number; alive: boolean; inventory: string[] }
interface BulletSnap { id: string; x: number; y: number; vx: number; vy: number; ownerId: string }
interface TickReplay {
  tick: number;
  actions?: ResolvedAction[];
  worldSnapshot: { bots: BotSnap[]; bullets?: BulletSnap[] };
}

const matchId = process.argv[2];
if (!matchId) {
  console.error("Usage: bun src/debug-match.ts <matchId>");
  process.exit(1);
}

const db = getDb();
const [m] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
if (!m) { console.error("match not found"); process.exit(1); }

const [r] = await db.select().from(matchReplays).where(eq(matchReplays.matchId, matchId)).limit(1);
const ticks = (r?.ticks as TickReplay[] | undefined) ?? [];
const parts = await db.select().from(matchParticipants).where(eq(matchParticipants.matchId, matchId));
const botRows = parts.length > 0
  ? await db.select().from(bots).where(inArray(bots.id, parts.map((p) => p.botId)))
  : [];
const name = new Map(botRows.map((b) => [b.id, b.name]));
const short = (id: string) => (name.get(id) ?? id.slice(0, 6));

console.log(`match ${matchId}`);
console.log(`  status=${m.status}  kind=${m.kind}  ticks=${ticks.length}`);
console.log(`  participants:`);
for (const p of parts) {
  console.log(`    ${short(p.botId).padEnd(20)} place=${p.placement ?? "-"}  finalHp=${p.finalHp ?? "-"}  dmg=${p.damageDealt}  picks=${p.itemsPicked}`);
}

console.log(`\nper-tick log (compact):`);
console.log(`  T  | bots (id @ x,y hp inv)  | actions  | bullets`);
for (const t of ticks) {
  const bs = t.worldSnapshot.bots
    .filter((b) => b.alive)
    .map((b) => `${short(b.id)}@${b.x},${b.y} hp${b.hp} ${b.inventory.length > 0 ? `[${b.inventory.join(",")}]` : ""}`)
    .join(" | ");
  const acts = (t.actions ?? [])
    .map((a) => {
      const t = a.applied.type;
      let detail = "";
      if (t === "SHOOT" && a.applied.target) detail = `(${a.applied.target.dx},${a.applied.target.dy})`;
      else if (a.applied.dir) detail = a.applied.dir;
      else if (a.applied.item) detail = a.applied.item;
      const why = a.reason ? `~${a.reason}` : "";
      const attempted = a.attempted.type === a.applied.type ? "" : `[wanted ${a.attempted.type}]`;
      return `${short(a.botId)}:${t}${detail}${attempted}${why}`;
    })
    .join("  ");
  const bullets = (t.worldSnapshot.bullets ?? [])
    .map((b) => `${short(b.ownerId)}→${b.x},${b.y}/(${b.vx},${b.vy})`)
    .join(" ");
  console.log(`  ${String(t.tick).padStart(3)} | ${bs}`);
  if (acts) console.log(`      | ${acts}`);
  if (bullets) console.log(`      | bullets: ${bullets}`);
}

process.exit(0);
