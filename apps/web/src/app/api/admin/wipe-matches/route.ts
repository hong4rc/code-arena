import { NextResponse, type NextRequest } from "next/server";

import { composition } from "@/composition";
import { requireAdmin } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let admin;
  try { admin = await requireAdmin(req.headers); }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }
  const result = await composition.wipeMatches.execute({ requestedBy: admin });
  return NextResponse.json({ ok: true, ...result });
}
