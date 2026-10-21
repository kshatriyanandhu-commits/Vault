import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "./db";
import { sessions, users, type SessionRow, type UserRow } from "./db/schema";
import { HttpError } from "./http";

export { HttpError };

export const SESSION_COOKIE = "argus_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const SESSION_REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Only refresh `lastSeenAt` when it is older than this, to bound write load. */
const LAST_SEEN_THROTTLE_MS = 60 * 1000;

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Privacy-conscious client-IP hash: SHA-256(ip + SESSION_PEPPER), truncated.
 * The raw IP is never stored. Falls back to "unknown" so routes still work
 * when no proxy headers are present.
 */
export async function hashClientIp(ip: string | null): Promise<string | null> {
  if (!ip) return null;
  const pepper = process.env.SESSION_PEPPER ?? "dev-only-unpeppered-ip-hash";
  return createHash("sha256")
    .update(`${ip}::${pepper}`)
    .digest("hex")
    .slice(0, 32);
}

export async function getRequestIdentity(): Promise<{
  ip: string | null;
  userAgent: string | null;
}> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",")[0]!.trim()
    : (h.get("x-real-ip") ?? null);
  const userAgent = h.get("user-agent");
  return { ip, userAgent: userAgent ? userAgent.slice(0, 400) : null };
}

export type SessionContext = {
  session: SessionRow;
  user: UserRow;
};

/**
 * Resolve the current session from the httpOnly cookie.
 * Returns null for missing/expired/signed-out/revoked sessions.
 * Throttled `lastSeenAt` refresh happens inline (awaited) so the admin
 * console sees reasonably fresh telemetry.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token || token.length < 20 || token.length > 200) return null;

  const tokenHash = hashToken(token);
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        eq(sessions.status, "active"),
        gt(sessions.expiresAt, sql`now()`),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const staleMs = Date.now() - row.session.lastSeenAt.getTime();
  if (staleMs > LAST_SEEN_THROTTLE_MS) {
    // Fire-safe: telemetry refresh must not break the request if it fails.
    try {
      await db
        .update(sessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(sessions.id, row.session.id));
      row.session.lastSeenAt = new Date();
    } catch {
      /* ignore telemetry refresh failures */
    }
  }
  return { session: row.session, user: row.user };
}

export async function requireUser(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) {
    throw new HttpError(401, "unauthenticated", "Sign in to continue.");
  }
  return ctx;
}

export async function requireAdmin(): Promise<SessionContext> {
  const ctx = await requireUser();
  if (ctx.user.role !== "admin") {
    throw new HttpError(
      403,
      "forbidden",
      "Administrator access is required.",
    );
  }
  return ctx;
}

/** Parse `?expiresInDays`-free explicit TTL from a remember flag. */
export function sessionTtlMs(remember: boolean): number {
  return remember ? SESSION_REMEMBER_TTL_MS : SESSION_TTL_MS;
}

/**
 * Set the session cookie. `secure` follows the actual request protocol so the
 * app works on plain http://localhost while still being correct behind TLS.
 */
export async function setSessionCookie(
  token: string,
  ttlMs: number,
  requestProto: string | null,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: requestProto === "https:",
    path: "/",
    maxAge: Math.floor(ttlMs / 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 0,
  });
}

/** Constant-time string compare helper used for origin checks. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Public-safe projection of a user row (no verifier, no key material). */
export function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}
