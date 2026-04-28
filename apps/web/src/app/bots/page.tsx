import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState } from "@/components/ui/EmptyState";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { composition } from "@/composition";
import { getCurrentUser } from "@/lib/auth";

import { DeleteBotButton } from "./delete-button.tsx";

export const dynamic = "force-dynamic";

export default async function MyBotsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const list = await composition.repos.bots.findByOwner(user.id);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>My bots</h1>
        <Link href="/bots/new"><button className="primary">New bot</button></Link>
      </div>
      {list.length === 0 ? (
        <EmptyState
          icon="🤖"
          title="No bots yet"
          body="Clone a sample bot to get started, or write one from scratch."
          cta={{ href: "/samples", label: "Browse samples" }}
        />
      ) : (
        <table>
          <thead>
            <tr><th>Name</th><th>Created</th><th></th><th></th></tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <td><Link href={`/bots/${b.id}`}>{b.name}</Link></td>
                <td style={{ color: "var(--fg-dim)" }}><RelativeTime date={b.createdAt} /></td>
                <td><Link href={`/bots/${b.id}`}>Edit →</Link></td>
                <td><DeleteBotButton botId={b.id} botName={b.name} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
