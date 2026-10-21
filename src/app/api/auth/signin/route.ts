import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import {
  assertSameOrigin,
  jsonError,
  jsonOk,
  parseJsonBody,
  routeHandler,
} from "@/server/http";
import { dummyVerify, verifyPassword } from "@/server/password";
import { rateLimit } from "@/server/rate-limit";
import {
  getRequestIdentity,
  hashClientIp,
  HttpError,
  setSessionCookie,
} from "@/server/session";
import { maskEmail, recordAudit } from "@/server/audit";
import { startSession } from "@/server/session-actions";
import { signinSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const GENERIC_FAILURE = "Invalid email or master password.";

/**
 * POST /api/auth/signin
 * The master password is verified server-side against a scrypt verifier (see
 * README "Security model"). The vault key stays in the browser.
 */
export const POST = routeHandler(async (req: NextRequest) => {
  await assertSameOrigin(req);
  const { ip, userAgent } = await getRequestIdentity();
  const ipHash = await hashClientIp(ip);

  const body = await parseJsonBody(req, signinSchema);

  const rl = rateLimit(
    `signin:${ipHash ?? "unknown"}:${body.email}`,
    8,
    15 * 60 * 1000,
  );
  if (!rl.allowed) {
    return jsonError(
      429,
      "rate_limited",
      "Too many sign-in attempts. Try again in a few minutes.",
    );
  }

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.emailNormalized, body.email))
    .limit(1);
  const user = userRows[0];

  if (!user) {
    await dummyVerify(); // equalize timing with the real verification path
    await recordAudit({
      event: "signin_failure",
      emailMasked: maskEmail(body.email),
      userAgent,
      ipHash,
    });
    throw new HttpError(401, "invalid_credentials", GENERIC_FAILURE);
  }

  const ok = await verifyPassword(body.password, user.passwordHash);
  if (!ok) {
    await recordAudit({
      event: "signin_failure",
      userId: user.id,
      emailMasked: maskEmail(user.emailNormalized),
      userAgent,
      ipHash,
    });
    throw new HttpError(401, "invalid_credentials", GENERIC_FAILURE);
  }

  const { token, ttlMs, session: sessionRow } = await startSession(user, {
    remember: body.remember ?? false,
    device: body.device,
    fingerprint: body.fingerprint ?? null,
    ipHash,
    userAgent,
  });
  await setSessionCookie(
    token,
    ttlMs,
    req.nextUrl.protocol === "https:"
      ? "https"
      : req.headers.get("x-forwarded-proto") === "https"
        ? "https"
        : null,
  );

  await recordAudit({
    event: "signin_success",
    userId: user.id,
    emailMasked: maskEmail(user.emailNormalized),
    userAgent,
    ipHash,
    meta: { remember: body.remember ?? false },
  });

  return jsonOk({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    },
    session: {
      id: sessionRow.id,
      status: sessionRow.status,
      signedInAt: sessionRow.signedInAt.toISOString(),
      lastSeenAt: sessionRow.lastSeenAt.toISOString(),
      expiresAt: sessionRow.expiresAt.toISOString(),
      deviceLabel: sessionRow.deviceLabel,
    },
    kdfSalt: user.kdfSalt,
    kdfIterations: user.kdfIterations,
    keyCheck: user.keyCheck,
  });
});
