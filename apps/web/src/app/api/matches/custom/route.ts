import { NextResponse, type NextRequest } from "next/server";

import { composition } from "@/composition";
import { requireUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireUser(req.headers); }
  catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const body = await req.json().catch(() => ({})) as { botIds?: unknown };
  const ids = Array.isArray(body.botIds) ? body.botIds.filter((s): s is string => typeof s === "string") : [];

  try {
    const result = await composition.createCustomMatch.execute({ botIds: ids, requestedBy: user });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "error";
    const status = message.startsWith("FORBIDDEN_BOT") ? 403
      : (message.startsWith("BOT_NOT_FOUND") ? 404 : 400);
    return NextResponse.json({ error: message.toLowerCase() }, { status });
  }
}
