import { NextRequest } from "next/server";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/server/db";
import { sessions, users } from "@/server/db/schema";
import { jsonError, jsonOk, routeHandler } from "@/server/http";
import { requireAdmin } from "@/server/session";
import { adminSessionsQuerySchema, toIlikePattern } from "@/lib/validation";
import type { SessionDto } from "@/lib/types";

export const dynamic = "force-dynamic";

const revokedByUser = alias(users, "revoked_by_user");

/**
 * GET /api/admin/sessions?search=&status=&limit=
 * Admin-only session ledger. Selects only from sessions + users; credential
 * rows (plaintext or ciphertext) are never touched by this query.
 */
export const GET = routeHandler(async (req: NextRequest) => {
  await requireAdmin();

  const url = new URL(req.url);
  const parsed = adminSessionsQuerySchema.safeParse({
    search: url.searchParams.get("search") ?? "",
    status: url.searchParams.get("status") ?? "all",
    limit: url.searchParams.get("limit") ?? "50",
  });
  if (!parsed.success) {
    return jsonError(400, "validation_failed", "Invalid query parameters.");
  }
  const { search, status, limit } = parsed.data;

  const conditions = [];
  if (status !== "all") {
    conditions.push(eq(sessions.status, status));
  }
  if (search) {
    const pattern = toIlikePattern(search);
    conditions.push(
      or(
        ilike(users.email, pattern),
        ilike(users.name, pattern),
        ilike(sessions.deviceLabel, pattern),
        ilike(sessions.userAgent, pattern),
        ilike(sessions.fingerprint, pattern),
      ),
    );
  }

  const rows = await db
    .select({
      session: sessions,
      userEmail: users.email,
      userName: users.name,
      userRole: users.role,
      revokedByEmail: revokedByUser.email,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .leftJoin(revokedByUser, eq(sessions.revokedBy, revokedByUser.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(sessions.signedInAt))
    .limit(limit);

  const result: SessionDto[] = rows.map((r) => ({
    id: r.session.id,
    status: r.session.status,
    signedInAt: r.session.signedInAt.toISOString(),
    lastSeenAt: r.session.lastSeenAt.toISOString(),
    expiresAt: r.session.expiresAt.toISOString(),
    signedOutAt: r.session.signedOutAt?.toISOString() ?? null,
    revokedAt: r.session.revokedAt?.toISOString() ?? null,
    deviceLabel: r.session.deviceLabel,
    deviceId: r.session.deviceId,
    userAgent: r.session.userAgent,
    fingerprint: r.session.fingerprint,
    ipHash: r.session.ipHash,
    user: {
      id: r.session.userId,
      email: r.userEmail,
      name: r.userName,
      role: r.userRole,
    },
    revokedByEmail: r.revokedByEmail ?? null,
  }));

  return jsonOk({ sessions: result, count: result.length });
});
