import { jsonOk, routeHandler } from "@/server/http";
import { getSessionContext, publicUser } from "@/server/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me
 * Restores an existing session from the httpOnly cookie. Returns 401 when no
 * valid session exists. Includes the (non-secret) KDF parameters + key-check
 * blob so the client can re-derive and verify the vault key after a reload.
 */
export const GET = routeHandler(async () => {
  const ctx = await getSessionContext();
  if (!ctx) {
    return jsonOk({ user: null, session: null }, 401);
  }
  const { session, user } = ctx;
  return jsonOk({
    user: publicUser(user),
    session: {
      id: session.id,
      status: session.status,
      signedInAt: session.signedInAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      deviceLabel: session.deviceLabel,
    },
    kdfSalt: user.kdfSalt,
    kdfIterations: user.kdfIterations,
    keyCheck: user.keyCheck,
  });
});
