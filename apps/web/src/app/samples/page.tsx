import { bots, eq, getDb } from "@arena/db";

export const dynamic = "force-dynamic";

export default async function SamplesPage() {
  const db = getDb();
  const list = await db.select().from(bots).where(eq(bots.isOfficial, true));

  return (
    <div>
      <h1>Sample bots</h1>
      <p>Click <b>Clone</b> to copy any sample into your own bots, then edit freely.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {list.length === 0 ? (
          <p>No samples loaded yet — run <code>bun packages/db/src/seed.ts</code> on the server.</p>
        ) : (
          list.map((b) => (
            <div className="card" key={b.id}>
              <h3 style={{ margin: 0 }}>{b.name}</h3>
              <p style={{ color: "#666" }}>{b.description}</p>
              <form action={`/api/bots/clone/${b.id}`} method="post">
                <button className="primary">Clone</button>
              </form>
            </div>
          ))
        )}
      </div>
    </div>
  );
}