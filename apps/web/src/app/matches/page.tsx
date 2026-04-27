export const dynamic = "force-dynamic";

import { desc, getDb, matches } from "@arena/db";

export default async function MatchesPage() {
  const db = getDb();
  const list = await db.select().from(matches).orderBy(desc(matches.createdAt)).limit(50);
  return (
    <div>
      <h1>Recent matches</h1>
      <table>
        <thead><tr><th>ID</th><th>Kind</th><th>Status</th><th>When</th><th></th></tr></thead>
        <tbody>
          {list.map((m) => (
            <tr key={m.id}>
              <td><code>{m.id.slice(0, 8)}</code></td>
              <td>{m.kind}</td>
              <td>{m.status}</td>
              <td>{new Date(m.createdAt).toLocaleString()}</td>
              <td><a href={`/replay/${m.id}`}>{m.status === "running" ? "Watch live →" : "Replay →"}</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}