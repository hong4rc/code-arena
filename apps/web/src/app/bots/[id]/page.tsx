import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BotEditor } from "@/components/BotEditor";
import { composition } from "@/composition";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function EditBotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const bot = await composition.repos.bots.findByIdAndOwner(id, user.id);
  if (!bot) notFound();
  const [latest, recent] = await Promise.all([
    composition.repos.bots.latestVersion(bot.id),
    composition.repos.matches.recentByBot(bot.id, 50),
  ]);

  return (
    <div>
      <h1>{bot.name}</h1>
      <BotEditor botId={bot.id} initialName={bot.name} initialCode={latest?.code ?? ""} />

      <section style={{ marginTop: 32 }}>
        <h2>Matches ({recent.length})</h2>
        {recent.length === 0 ? (
          <p style={{ color: "var(--fg-dim)" }}>No matches yet — this bot hasn&apos;t played.</p>
        ) : (
          <table>
            <thead>
              <tr><th>ID</th><th>Kind</th><th>Status</th><th>Placement</th><th>Δ rating</th><th>When</th><th></th></tr>
            </thead>
            <tbody>
              {recent.map((m) => (
                <tr key={m.id}>
                  <td><code>{m.id.slice(0, 8)}</code></td>
                  <td>{m.kind}</td>
                  <td><span className={`badge ${m.status}`}>{m.status}</span></td>
                  <td>{m.placement ?? "—"}</td>
                  <td style={{ color: m.ratingDelta && m.ratingDelta > 0 ? "var(--green)" : "var(--fg-dim)" }}>
                    {m.ratingDelta === null ? "—" : (m.ratingDelta > 0 ? `+${m.ratingDelta.toFixed(1)}` : m.ratingDelta.toFixed(1))}
                  </td>
                  <td style={{ color: "var(--fg-dim)" }}>{m.createdAt.toLocaleString()}</td>
                  <td><Link href={`/replay/${m.id}`}>{m.status === "running" ? "Watch live →" : "Replay →"}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
