import { NextResponse, type NextRequest } from "next/server";

import { composition } from "@/composition";
import { requireAdmin } from "@/lib/auth";

/**
 * GET /api/admin/bots/:id/params
 *   Download the latest bot_params blob as JSON (Content-Disposition: attachment).
 *
 * Query:
 *   ?version=N    return that specific version (otherwise latest)
 *   ?history=10   return an array of the last N versions instead of one
 *
 * Admin only — params are sensitive (trained weights / proprietary tuning).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(req.headers); }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }
  const { id } = await ctx.params;

  const bot = await composition.repos.bots.findById(id);
  if (!bot) return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const versionStr = url.searchParams.get("version");
  const historyStr = url.searchParams.get("history");

  let body: unknown;
  let suffix: string;
  if (historyStr) {
    const limit = Math.max(1, Math.min(100, Number(historyStr) || 10));
    body = await composition.repos.botParams.history(id, limit);
    suffix = `last-${limit}`;
  } else if (versionStr) {
    const version = Number(versionStr);
    const all = await composition.repos.botParams.history(id, 200);
    const row = all.find((r) => r.version === version);
    if (!row) return NextResponse.json({ error: `version ${version} not found` }, { status: 404 });
    body = row;
    suffix = `v${version}`;
  } else {
    const latest = await composition.repos.botParams.latest(id);
    if (!latest) return NextResponse.json({ error: "no params yet" }, { status: 404 });
    body = latest;
    suffix = `v${latest.version}`;
  }

  const safeName = bot.name.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${safeName}-${suffix}.json`;
  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
