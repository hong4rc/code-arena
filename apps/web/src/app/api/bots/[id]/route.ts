import { NextResponse, type NextRequest } from "next/server";

import { composition } from "@/composition";
import { requireUser } from "@/lib/auth";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireUser(req.headers); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const { id } = await ctx.params;

  const bot = await composition.repos.bots.findByIdAndOwner(id, user.id);
  if (!bot) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as { name?: string; code?: string };
  if (!body.name || !body.code) return NextResponse.json({ error: "name and code required" }, { status: 400 });

  const result = await composition.saveBot.execute({ ownerId: user.id, botId: bot.id, name: body.name, code: body.code });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireUser(req.headers); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const { id } = await ctx.params;
  try {
    await composition.deleteBot.execute({ botId: id, requestedBy: user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "error";
    const status = message === "FORBIDDEN" ? 403 : (message === "NOT_FOUND" ? 404 : 500);
    return NextResponse.json({ error: message.toLowerCase() }, { status });
  }
  return NextResponse.json({ ok: true });
}
