import { NextRequest } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/server/db";
import { auditEvents } from "@/server/db/schema";
import { jsonOk, routeHandler } from "@/server/http";
import { requireAdmin } from "@/server/session";
import type { AuditEventDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/audit?limit=
 * Recent audit events (safe metadata only: event type, masked email, hashed
 * IP, user agent). Rows never contain passwords, keys, tokens or ciphertext.
 */
export const GET = routeHandler(async (req: NextRequest) => {
  await requireAdmin();

  const rawLimit = new URL(req.url).searchParams.get("limit") ?? "50";
  const limit = Math.min(200, Math.max(1, Number(rawLimit) || 50));

  const rows = await db
    .select({
      id: auditEvents.id,
      event: auditEvents.event,
      emailMasked: auditEvents.emailMasked,
      userAgent: auditEvents.userAgent,
      ipHash: auditEvents.ipHash,
      createdAt: auditEvents.createdAt,
      userId: auditEvents.userId,
      sessionId: auditEvents.sessionId,
      meta: auditEvents.meta,
    })
    .from(auditEvents)
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);

  const result: AuditEventDto[] = rows.map((r) => ({
    id: r.id,
    event: r.event,
    emailMasked: r.emailMasked,
    userAgent: r.userAgent,
    ipHash: r.ipHash,
    createdAt: r.createdAt.toISOString(),
    userId: r.userId,
    sessionId: r.sessionId,
    meta: r.meta,
  }));

  return jsonOk({ events: result, count: result.length });
});
