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
  const latest = await composition.repos.bots.latestVersion(bot.id);

  return (
    <div>
      <h1>{bot.name}</h1>
      <BotEditor botId={bot.id} initialName={bot.name} initialCode={latest?.code ?? ""} />
    </div>
  );
}
