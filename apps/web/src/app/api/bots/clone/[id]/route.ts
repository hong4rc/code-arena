import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { and, bots, botVersions, desc, eq, getDb } from "@arena/db";
import { requireUser } from "@/lib/auth";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const db = getDb();
  const [src] = await db.select().from(bots).where(and(eq(bots.id, id), eq(bots.isPublic, true))).limit(1);
  if (!src) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [srcVer] = await db
    .select()
    .from(botVersions)
    .where(eq(botVersions.botId, src.id))
    .orderBy(desc(botVersions.uploadedAt))
    .limit(1);
  if (!srcVer) return NextResponse.json({ error: "source has no version" }, { status: 400 });

  const [created] = await db
    .insert(bots)
    .values({
      ownerId: user.id,
      name: `${src.name}-copy`,
      description: src.description ?? null,
      clonedFromBotId: src.id,
    })
    .returning();
  const sha = createHash("sha256").update(srcVer.code).digest("hex");
  const [version] = await db
    .insert(botVersions)
    .values({
      botId: created!.id,
      code: srcVer.code,
      language: srcVer.language,
      isRunnable: srcVer.isRunnable,
      validationLog: srcVer.validationLog,
      sha256: sha,
    })
    .returning();
  await db.update(bots).set({ currentVersionId: version!.id }).where(eq(bots.id, created!.id));

  return NextResponse.redirect(new URL(`/bots/${created!.id}`, _req.url), { status: 303 });
}
