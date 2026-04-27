import { NextResponse, type NextRequest } from "next/server";

import { composition } from "@/composition";
import { requireAdmin } from "@/lib/auth";

/**
 * Toggle a bot's `is_training_target` flag. The trainer service polls this
 * column every round, so the change takes effect within ~1 round.
 *
 * Body: { on: boolean }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(req.headers); }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { on?: unknown };
  const on = Boolean(body.on);
  await composition.repos.bots.setTrainingTarget(id, on);
  return NextResponse.json({ ok: true, id, on });
}
