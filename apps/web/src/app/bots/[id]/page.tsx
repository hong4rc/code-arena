export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { and, bots, botVersions, desc, eq, getDb } from "@arena/db";
import { getCurrentUser } from "@/lib/auth";
import { BotEditor } from "@/components/BotEditor";

export default async function EditBotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const db = getDb();
  const [bot] = await db.select().from(bots).where(and(eq(bots.id, id), eq(bots.ownerId, user.id))).limit(1);
  if (!bot) notFound();
  const [latest] = await db
    .select()
    .from(botVersions)
    .where(eq(botVersions.botId, bot.id))
    .orderBy(desc(botVersions.uploadedAt))
    .limit(1);

  return (
    <div>
      <h1>{bot.name}</h1>
      <BotEditor botId={bot.id} initialName={bot.name} initialCode={latest?.code ?? ""} />
    </div>
  );
}