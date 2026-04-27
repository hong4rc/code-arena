import { auth } from "@/lib/auth-server";

import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return auth.handler(req);
}
export async function POST(req: NextRequest) {
  return auth.handler(req);
}
