import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface Tool {
  href: string;
  title: string;
  blurb: string;
}

const TOOLS: Tool[] = [
  {
    href: "/admin/training",
    title: "Training",
    blurb: "Toggle bots into the in-process trainer. Download evolved params blobs.",
  },
  {
    href: "/admin/data",
    title: "Data cleanup",
    blurb: "Delete individual bots or matches. Wipe all matches.",
  },
  {
    href: "/matches/new",
    title: "Custom match",
    blurb: "Pick 2–10 bots and start a non-ranked match immediately.",
  },
];

export default async function AdminIndexPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  return (
    <div>
      <h1>Admin</h1>
      <p style={{ color: "var(--fg-dim)" }}>
        Tools available because <b>{user.name ?? user.email}</b> is an admin.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, marginTop: 16 }}>
        {TOOLS.map((t) => (
          <Link key={t.href} href={t.href} className="card" style={{ textDecoration: "none" }}>
            <h3 style={{ margin: 0 }}>{t.title}</h3>
            <p style={{ marginTop: 6, marginBottom: 0 }}>{t.blurb}</p>
            <div style={{ marginTop: 8, fontSize: "0.8em", color: "var(--fg-dim)" }}>
              <code>{t.href}</code>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
