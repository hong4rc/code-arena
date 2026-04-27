import { NextResponse, type NextRequest } from "next/server";

import { composition } from "@/composition";
import { requireUser } from "@/lib/auth";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireUser(); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const { id } = await ctx.params;

  try {
    const result = await composition.cloneBot.execute({ ownerId: user.id, sourceBotId: id });
    return NextResponse.redirect(new URL(`/bots/${result.botId}`, req.url), { status: 303 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
