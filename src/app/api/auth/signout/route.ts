import { jsonOk, routeHandler } from "@/server/http";
import {
  clearSessionCookie,
  getSessionContext,
  hashClientIp,
  getRequestIdentity,
} from "@/server/session";
import { maskEmail, recordAudit } from "@/server/audit";
import { endSession } from "@/server/session-actions";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/signout
 * Idempotent: always clears the cookie; revokes the session row when present.
 */
export const POST = routeHandler(async () => {
  const ctx = await getSessionContext();
  if (ctx) {
    await endSession(ctx.session.id, "signed_out");
    const { ip, userAgent } = await getRequestIdentity();
    const ipHash = await hashClientIp(ip);
    await recordAudit({
      event: "signout",
      userId: ctx.user.id,
      sessionId: ctx.session.id,
      emailMasked: maskEmail(ctx.user.emailNormalized),
      userAgent,
      ipHash,
    });
  }
  await clearSessionCookie();
  return jsonOk({ ok: true });
});
