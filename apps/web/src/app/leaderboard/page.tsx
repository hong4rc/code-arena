import { composition } from "@/composition";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const season = await composition.repos.seasons.findActive();
  if (!season) return <p>No active season.</p>;
  const rows = await composition.repos.ratings.leaderboard(season.id, 100);

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
