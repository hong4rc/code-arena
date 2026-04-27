import Link from "next/link";

import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  return (
    <div>
      <h1>Submit a bot. Watch it battle.</h1>
      <p style={{ fontSize: "1.05rem", maxWidth: 640 }}>
        Code Arena runs a turn-based grid battle royale. Every 5 minutes the server matches up
        ten bots and plays them out. Climb the Glicko-2 ladder, watch live matches stream over
        WebSocket, and rewatch any past replay frame-by-frame.
      </p>

      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        {user ? (
          <Link href="/bots" className="btn primary">Go to my bots →</Link>
        ) : (
          <Link href="/login" className="btn primary">Sign in with Google</Link>
        )}
        <Link href="/samples" className="btn">Browse sample bots</Link>
        <Link href="/matches" className="btn">Watch matches</Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginTop: 36 }}>
        <div className="card">
          <h3 style={{ color: "var(--mauve)" }}>① Pick a starter</h3>
          <p>Clone any sample bot — random, greedy, defensive, hunter — and edit it in the browser.</p>
        </div>
        <div className="card">
          <h3 style={{ color: "var(--blue)" }}>② Save & enroll</h3>
          <p>Save runs an AST denylist + smoke-run against your bot. Pass and you&apos;re in the matchmaking pool.</p>
        </div>
        <div className="card">
          <h3 style={{ color: "var(--green)" }}>③ Climb the ladder</h3>
          <p>Every 5 min: 3 ranked matches with bots near your rating. WebSocket live-stream + replay viewer for every match.</p>
        </div>
      </div>

      <h2 style={{ marginTop: 36 }}>The bot API</h2>
      <p>Single file. No imports. Default-export a <code>decide(observation)</code> function:</p>
      <pre style={{
        background: "var(--mantle)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 16,
        overflow: "auto",
        color: "var(--text)",
      }}>
        <code style={{ background: "transparent", border: "none", padding: 0, color: "inherit" }}>{`export default function decide(obs) {
  if (lowHp(obs) && hasItem(obs, "HEAL")) return { type: "USE", item: "HEAL" };
  const dir = bestAttackDir(obs);
  if (dir) return { type: "ATTACK", dir };
  if (canPickup(obs)) return { type: "PICKUP" };
  const item = nearestItem(obs);
  if (item) return { type: "MOVE", dir: dirTo(item.dx, item.dy) };
  return { type: "MOVE", dir: safestDir(obs) };
}`}</code>
      </pre>
      <p style={{ marginTop: 8 }}>
        Full helper reference: <a href="https://github.com/hong4rc/code-arena/blob/main/docs/HELPERS.md" target="_blank" rel="noreferrer">docs/HELPERS.md</a>.
      </p>
    </div>
  );
}
