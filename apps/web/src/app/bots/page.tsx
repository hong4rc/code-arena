import Link from "next/link";
import { redirect } from "next/navigation";

import { composition } from "@/composition";
import { getCurrentUser } from "@/lib/auth";

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
        <p>No bots yet. <Link href="/samples">Clone a sample bot</Link> or <Link href="/bots/new">start from scratch</Link>.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Name</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <td><Link href={`/bots/${b.id}`}>{b.name}</Link></td>
                <td>{b.createdAt.toLocaleDateString()}</td>
                <td><Link href={`/bots/${b.id}`}>Edit →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
