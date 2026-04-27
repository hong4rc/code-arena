export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { bots, eq, getDb } from "@arena/db";
import { getCurrentUser } from "@/lib/auth";

export default async function MyBotsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const db = getDb();
  const list = await db.select().from(bots).where(eq(bots.ownerId, user.id));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>My bots</h1>
        <a href="/bots/new"><button className="primary">New bot</button></a>
      </div>
      {list.length === 0 ? (
        <p>No bots yet. <a href="/samples">Clone a sample bot</a> or <a href="/bots/new">start from scratch</a>.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Name</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <td><a href={`/bots/${b.id}`}>{b.name}</a></td>
                <td>{new Date(b.createdAt).toLocaleDateString()}</td>
                <td><a href={`/bots/${b.id}`}>Edit →</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}