import { NextResponse, type NextRequest } from "next/server";

import { composition } from "@/composition";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req.headers);
  if (!user) {
    return NextResponse.redirect(new URL("/login?reason=clone-needs-auth", req.url), { status: 303 });
  }

  const { id } = await ctx.params;
  try {
    const result = await composition.cloneBot.execute({ ownerId: user.id, sourceBotId: id });
    return NextResponse.redirect(new URL(`/bots/${result.botId}`, req.url), { status: 303 });
  } catch (error) {
    const message = (error as Error).message;
    return NextResponse.redirect(new URL(`/samples?clone_error=${encodeURIComponent(message)}`, req.url), { status: 303 });
  }
}
