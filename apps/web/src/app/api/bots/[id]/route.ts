import { NextResponse, type NextRequest } from "next/server";
import { and, bots, eq, getDb } from "@arena/db";
import { requireUser } from "@/lib/auth";
import { saveBot } from "@/lib/save-bot";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const db = getDb();
  const [bot] = await db.select().from(bots).where(and(eq(bots.id, id), eq(bots.ownerId, user.id))).limit(1);
  if (!bot) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as { name?: string; code?: string };
  if (!body.name || !body.code) return NextResponse.json({ error: "name and code required" }, { status: 400 });

  const result = await saveBot({ ownerId: user.id, botId: bot.id, name: body.name, code: body.code });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const db = getDb();
  const result = await db.delete(bots).where(and(eq(bots.id, id), eq(bots.ownerId, user.id))).returning();
  if (result.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
