import { redirect } from "next/navigation";

import { composition } from "@/composition";
import { getCurrentUser } from "@/lib/auth";

import { CustomMatchPicker } from "./picker.tsx";

export const dynamic = "force-dynamic";

export default async function NewCustomMatchPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Eligible bots: own + official + public. Dedupe by id.
  const [own, official, active] = await Promise.all([
    composition.repos.bots.findByOwner(user.id),
    composition.repos.bots.findOfficial(),
    composition.repos.bots.findActive(),
  ]);
  const seen = new Set<string>();
  const all = [...own, ...official, ...active].filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));

  return (
    <div>
      <h1>New custom match</h1>
      <p style={{ color: "var(--fg-dim)" }}>
        Pick 2–10 bots. Match starts immediately, doesn&apos;t affect rating, and runs as soon as the runner is free.
      </p>
      <CustomMatchPicker bots={all.map((b) => ({
        id: b.id,
        name: b.name,
        ownerId: b.ownerId,
        isOfficial: b.isOfficial,
        isOwn: b.ownerId === user.id,
      }))} />
    </div>
  );
}
