import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/auth";
import { saveBot } from "@/lib/save-bot";

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json()) as { name?: string; code?: string };
  if (!body.name || !body.code) return NextResponse.json({ error: "name and code required" }, { status: 400 });

  const result = await saveBot({ ownerId: user.id, name: body.name, code: body.code });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
