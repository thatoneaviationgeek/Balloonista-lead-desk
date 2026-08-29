import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { leadEvents, leads } from "@/db/schema";

const ALLOWED = ["New", "Approved", "Rejected"] as const;
type Status = (typeof ALLOWED)[number];

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot change a lead" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as {
    status?: string;
    note?: string;
  } | null;

  const status = body?.status as Status | undefined;
  if (!status || !ALLOWED.includes(status)) {
    return NextResponse.json(
      { error: "status must be one of " + ALLOWED.join(", ") },
      { status: 400 },
    );
  }

  const existing = (await db.select().from(leads).where(eq(leads.id, id)).limit(1))[0];
  if (!existing) return NextResponse.json({ error: "No such lead" }, { status: 404 });
  if (existing.status === status) {
    return NextResponse.json({ ok: true, lead: existing, unchanged: true });
  }

  const now = new Date();
  const [updated] = await db
    .update(leads)
    .set({
      status,
      statusChangedAt: now,
      statusChangedBy: session.user.id || null,
      updatedAt: now,
      ...(body?.note !== undefined ? { notes: body.note } : {}),
    })
    .where(eq(leads.id, id))
    .returning();

  await db.insert(leadEvents).values({
    leadId: id,
    actorId: session.user.id || null,
    actorEmail: session.user.email ?? null,
    fromStatus: existing.status,
    toStatus: status,
    note: body?.note ?? null,
  });

  return NextResponse.json({ ok: true, lead: updated });
}
