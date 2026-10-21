import { and, count, gte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { auditEvents, credentials, sessions, users } from "@/server/db/schema";
import { jsonOk, routeHandler } from "@/server/http";
import { requireAdmin } from "@/server/session";
import type { AdminStatsDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/stats
 * Aggregate counters only. The credentials table contributes a COUNT(*) and
 * nothing else — no ciphertext, no metadata, no ownership mapping beyond the
 * total.
 */
export const GET = routeHandler(async () => {
  await requireAdmin();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [userRows, credentialRows, statusRows, eventRows] = await Promise.all([
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(credentials),
    db
      .select({ status: sessions.status, value: count() })
      .from(sessions)
      .groupBy(sessions.status),
    db
      .select({ event: auditEvents.event, value: count() })
      .from(auditEvents)
      .where(
        and(
          gte(auditEvents.createdAt, since),
          sql`${auditEvents.event} in ('signin_success', 'signin_failure')`,
        ),
      )
      .groupBy(auditEvents.event),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of statusRows) byStatus[row.status] = row.value;
  const eventsByType: Record<string, number> = {};
  for (const row of eventRows) eventsByType[row.event] = row.value;

  const stats: AdminStatsDto = {
    totalUsers: userRows[0]?.value ?? 0,
    totalCredentials: credentialRows[0]?.value ?? 0,
    sessions: {
      active: byStatus["active"] ?? 0,
      signed_out: byStatus["signed_out"] ?? 0,
      revoked: byStatus["revoked"] ?? 0,
    },
    events24h: {
      signin_success: eventsByType["signin_success"] ?? 0,
      signin_failure: eventsByType["signin_failure"] ?? 0,
    },
    generatedAt: new Date().toISOString(),
  };

  return jsonOk(stats);
});

