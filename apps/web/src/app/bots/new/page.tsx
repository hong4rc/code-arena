import { readFileSync } from "node:fs";
import { join } from "node:path";

import { redirect } from "next/navigation";

import { BotEditor } from "@/components/BotEditor";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const TEMPLATE_PATH = join(process.cwd(), "..", "..", "bots", "samples", "bot-template.js");

export default async function NewBotPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  let template: string;
  try {
    template = readFileSync(TEMPLATE_PATH, "utf8");
  } catch {
    template = "// template not found — paste your bot here\n";
  }
  return (
    <div>
      <h1>New bot</h1>
      <BotEditor initialName="my-bot" initialCode={template} />
    </div>
  );
}