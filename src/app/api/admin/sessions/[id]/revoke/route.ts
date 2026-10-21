import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { sessions } from "@/server/db/schema";
import { assertSameOrigin, jsonOk, routeHandler } from "@/server/http";
import { HttpError, requireAdmin } from "@/server/session";
import { recordAudit } from "@/server/audit";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/admin/sessions/[id]/revoke
 * Marks an active session revoked (invalidates its cookie immediately because
 * session lookups require status = 'active').
 */
export const POST = routeHandler(async (req: NextRequest, ctx?: unknown) => {
  await assertSameOrigin(req);
  const { user: admin } = await requireAdmin();
  const { id } = await (ctx as RouteContext).params;
  if (!UUID_RE.test(id)) {
    throw new HttpError(400, "invalid_id", "Session id must be a UUID.");
  }

  const [updated] = await db
    .update(sessions)
    .set({ status: "revoked", revokedAt: new Date(), revokedBy: admin.id })
    .where(and(eq(sessions.id, id), eq(sessions.status, "active")))
    .returning({ id: sessions.id, status: sessions.status });

  if (!updated) {
    const existing = await db
      .select({ id: sessions.id, status: sessions.status })
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    if (existing.length === 0) {
      throw new HttpError(404, "not_found", "Session not found.");
    }
    throw new HttpError(
      409,
      "not_active",
      `Session is already ${existing[0]!.status.replace("_", " ")}.`,
    );
  }

  await recordAudit({
    event: "session_revoke",
    userId: admin.id,
    emailMasked: maskOnly(admin.email),
    meta: { targetSessionId: id },
  });

  return jsonOk({ ok: true, id, status: "revoked" });
});

function maskOnly(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***@${email.slice(at + 1)}`.slice(0, 120);
}
