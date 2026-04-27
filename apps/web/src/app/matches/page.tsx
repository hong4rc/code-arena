import Link from "next/link";

import { composition } from "@/composition";

export const dynamic = "force-dynamic";

export default async function MatchesPage() {
  const list = await composition.repos.matches.recent(50);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Recent matches</h1>
        <Link href="/matches/new"><button className="primary">New custom match</button></Link>
      </div>
      <p>The last 50 matches across all kinds. Click a row to watch live or replay.</p>
      {list.length === 0 ? (
        <p style={{ color: "var(--fg-dim)" }}>No matches yet — they&apos;ll show up here once the scheduler runs.</p>
      ) : (
        <table>
          <thead>
            <tr><th>ID</th><th>Kind</th><th>Status</th><th>When</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id}>
                <td><code>{m.id.slice(0, 8)}</code></td>
                <td>{m.kind}</td>
                <td><span className={`badge ${m.status}`}>{m.status}</span></td>
                <td style={{ color: "var(--fg-dim)" }}>{m.createdAt.toLocaleString()}</td>
                <td><Link href={`/replay/${m.id}`}>{m.status === "running" ? "Watch live →" : "Replay →"}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
