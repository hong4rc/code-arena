import { and, bots, desc, eq, getDb, ratings, seasons } from "@arena/db";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const db = getDb();
  const [season] = await db.select().from(seasons).where(eq(seasons.isActive, true)).limit(1);
  if (!season) return <p>No active season.</p>;
  const rows = await db
    .select({ botId: ratings.botId, name: bots.name, rating: ratings.rating, rd: ratings.rd, games: ratings.games })
    .from(ratings)
    .innerJoin(bots, eq(bots.id, ratings.botId))
    .where(and(eq(ratings.seasonId, season.id)))
    .orderBy(desc(ratings.rating))
    .limit(100);

  return (
    <div>
      <h1>Leaderboard — {season.name}</h1>
      <table>
        <thead><tr><th>#</th><th>Bot</th><th>Rating</th><th>RD</th><th>Games</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.botId}>
              <td>{i + 1}</td>
              <td>{r.name}</td>
              <td>{r.rating.toFixed(0)}</td>
              <td>±{r.rd.toFixed(0)}</td>
              <td>{r.games}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}