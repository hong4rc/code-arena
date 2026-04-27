import Link from "next/link";

import { composition } from "@/composition";

export const dynamic = "force-dynamic";

export default async function MatchesPage() {
  const list = await composition.repos.matches.recent(50);
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
              <td>{m.createdAt.toLocaleString()}</td>
              <td><Link href={`/replay/${m.id}`}>{m.status === "running" ? "Watch live →" : "Replay →"}</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
