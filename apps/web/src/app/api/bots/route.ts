import { NextResponse, type NextRequest } from "next/server";

import { composition } from "@/composition";
import { requireUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireUser(req.headers); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  const body = (await req.json()) as { name?: string; code?: string };
  if (!body.name || !body.code) return NextResponse.json({ error: "name and code required" }, { status: 400 });

  const result = await composition.saveBot.execute({ ownerId: user.id, name: body.name, code: body.code });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
