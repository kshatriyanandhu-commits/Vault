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
import { hashPassword } from "@/server/password";
import { rateLimit } from "@/server/rate-limit";
import {
  getRequestIdentity,
  hashClientIp,
  HttpError,
  publicUser,
  setSessionCookie,
} from "@/server/session";
import { maskEmail, recordAudit } from "@/server/audit";
import { startSession } from "@/server/session-actions";
import { DEFAULT_KDF_ITERATIONS } from "@/lib/crypto";
import { signupSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/signup
 *
 * Security model (documented, honest): the master password IS transmitted here
 * over the connection so the server can store a scrypt verifier. This is not a
 * PAKE / zero-knowledge authentication scheme. The *vault encryption key*,
 * however, is derived in the browser and never reaches the server; the server
 * only stores ciphertext.
 *
 * `role` is not accepted from input — admins are provisioned only through
 * `npm run db:seed:admin` (environment-configured).
 */
export const POST = routeHandler(async (req: NextRequest) => {
  await assertSameOrigin(req);
  const { ip, userAgent } = await getRequestIdentity();
  const ipHash = await hashClientIp(ip);

  const rl = rateLimit(`signup:${ipHash ?? "unknown"}`, 10, 60 * 60 * 1000);
  if (!rl.allowed) {
    return jsonError(
      429,
      "rate_limited",
      "Too many sign-up attempts. Try again later.",
    );
  }

  const body = await parseJsonBody(req, signupSchema);

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.emailNormalized, body.email))
    .limit(1);
  if (existing.length > 0) {
    throw new HttpError(
      409,
      "email_taken",
      "An account with this email already exists.",
    );
  }

  const passwordHash = await hashPassword(body.password);

  const [user] = await db
    .insert(users)
    .values({
      email: body.email,
      emailNormalized: body.email,
      name: body.name,
      role: "user", // never from input
      passwordHash,
      kdfSalt: body.kdfSalt,
      kdfIterations: Number(
        process.env.VAULT_KDF_ITERATIONS ?? DEFAULT_KDF_ITERATIONS,
      ),
      keyCheck: body.keyCheck,
    })
    .returning();

  if (!user) {
    throw new HttpError(500, "internal_error", "Could not create the account.");
  }

  const { token, ttlMs, session: sessionRow } = await startSession(user, {
    remember: true, // fresh accounts stay signed in; later sign-ins honor "remember"
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
    event: "signup",
    userId: user.id,
    emailMasked: maskEmail(user.emailNormalized),
    userAgent,
    ipHash,
  });
  await recordAudit({
    event: "signin_success",
    userId: user.id,
    emailMasked: maskEmail(user.emailNormalized),
    userAgent,
    ipHash,
    meta: { via: "signup" },
  });

  return jsonOk(
    {
      user: publicUser(user),
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
    },
    201,
  );
});
