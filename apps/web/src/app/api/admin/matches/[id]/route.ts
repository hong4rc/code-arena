import { NextResponse, type NextRequest } from "next/server";

import { composition } from "@/composition";
import { requireAdmin } from "@/lib/auth";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let admin;
  try { admin = await requireAdmin(req.headers); }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }
  const { id } = await ctx.params;
  await composition.deleteMatch.execute({ matchId: id, requestedBy: admin });
  return NextResponse.json({ ok: true });
}
