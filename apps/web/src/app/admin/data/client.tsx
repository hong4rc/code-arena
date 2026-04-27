"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface BotRow { id: string; name: string; isOfficial: boolean; ownerId: string }
interface MatchRow { id: string; kind: string; status: string; createdAt: string }

export function AdminDataClient({ bots, matches }: { bots: BotRow[]; matches: MatchRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function deleteBot(id: string, name: string) {
    if (!globalThis.confirm(`Delete bot "${name}" and all its matches/ratings? This is irreversible.`)) return;
    setBusyId(id);
    const res = await fetch(`/api/admin/bots/${id}`, { method: "DELETE" });
    setBusyId(null);
    if (!res.ok) { globalThis.alert(`Delete failed: ${res.status}`); return; }
    start(() => router.refresh());
  }

  async function deleteMatch(id: string) {
    if (!globalThis.confirm(`Delete match ${id.slice(0, 8)}? Replay and participants are removed too.`)) return;
    setBusyId(id);
    const res = await fetch(`/api/admin/matches/${id}`, { method: "DELETE" });
    setBusyId(null);
    if (!res.ok) { globalThis.alert(`Delete failed: ${res.status}`); return; }
    start(() => router.refresh());
  }

  async function wipeMatches() {
    if (!globalThis.confirm("Wipe ALL matches (every replay and participant row)? Bots, ratings, queue stay.")) return;
    setBusyId("__wipe__");
    const res = await fetch(`/api/admin/wipe-matches`, { method: "POST" });
    setBusyId(null);
    if (!res.ok) { globalThis.alert(`Wipe failed: ${res.status}`); return; }
    const body = await res.json() as { removed: number };
    globalThis.alert(`Removed ${body.removed} matches.`);
    start(() => router.refresh());
  }

  const disabled = pending || busyId !== null;

  return (
    <div>
      <h1>Admin · Data cleanup</h1>
      <p style={{ color: "var(--fg-dim)" }}>Delete stale bots and matches. Cascades remove replays, participants, ratings, and queue rows.</p>

      <section style={{ marginTop: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Matches ({matches.length})</h2>
          <button className="danger" onClick={wipeMatches} disabled={disabled} style={{ minWidth: 160 }}>
            {busyId === "__wipe__" ? "Wiping…" : "Wipe all matches"}
          </button>
        </div>
        {matches.length === 0 ? <p>No matches.</p> : (
          <table>
            <thead><tr><th>ID</th><th>Kind</th><th>Status</th><th>When</th><th></th></tr></thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.id}>
                  <td><code>{m.id.slice(0, 8)}</code></td>
                  <td>{m.kind}</td>
                  <td><span className={`badge ${m.status}`}>{m.status}</span></td>
                  <td style={{ color: "var(--fg-dim)" }}>{new Date(m.createdAt).toLocaleString()}</td>
                  <td>
                    <button className="danger" onClick={() => deleteMatch(m.id)} disabled={disabled} style={{ minWidth: 88 }}>
                      {busyId === m.id ? "Deleting…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>Bots ({bots.length})</h2>
        {bots.length === 0 ? <p>No bots.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Owner</th><th>Official</th><th></th></tr></thead>
            <tbody>
              {bots.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td><code>{b.ownerId.slice(0, 8)}</code></td>
                  <td>{b.isOfficial ? "yes" : ""}</td>
                  <td>
                    <button className="danger" onClick={() => deleteBot(b.id, b.name)} disabled={disabled} style={{ minWidth: 88 }}>
                      {busyId === b.id ? "Deleting…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
