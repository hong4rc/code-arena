import Link from "next/link";

import { EmptyState } from "@/components/ui/EmptyState";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { composition } from "@/composition";

export const dynamic = "force-dynamic";

export default async function MatchesPage() {
  const list = await composition.repos.matches.recentWithWinner(50);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1>Recent matches</h1>
        <Link href="/matches/new"><button className="primary">New custom match</button></Link>
      </div>
      <p>The last 50 matches across all kinds. Click a row to watch live or replay.</p>
      {list.length === 0 ? (
        <EmptyState
          icon="⚔"
          title="No matches yet"
          body="They'll show up here once the scheduler runs (every 5 min) or you start a custom match."
          cta={{ href: "/matches/new", label: "Start a custom match" }}
        />
      ) : (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Kind</th>
              <th>Status</th>
              <th>Winner</th>
              <th>When</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id}>
                <td><code>{m.id.slice(0, 8)}</code></td>
                <td>{m.kind}</td>
                <td><span className={`badge ${m.status}`}>{m.status}</span></td>
                <td>
                  {m.winnerName ? (
                    <span style={{ color: "var(--green)", fontWeight: 600 }}>🏆 {m.winnerName}</span>
                  ) : (
                    <span style={{ color: "var(--fg-dim)" }}>—</span>
                  )}
                </td>
                <td style={{ color: "var(--fg-dim)" }}><RelativeTime date={m.createdAt} /></td>
                <td><Link href={`/replay/${m.id}`}>{m.status === "running" ? "Watch live →" : "Replay →"}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
