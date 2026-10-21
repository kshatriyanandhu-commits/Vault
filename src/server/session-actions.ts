import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { sessions, type SessionRow, type UserRow } from "./db/schema";
import {
  generateSessionToken,
  hashToken,
  sessionTtlMs,
} from "./session";

export type DeviceHint = { id: string; label: string } | undefined;

/**
 * Create a session row and return the opaque token (returned once; only its
 * SHA-256 hash is persisted). Client-supplied device/fingerprint data is stored
 * strictly as untrusted display hints and is never used for authorization.
 */
export async function startSession(
  user: UserRow,
  opts: {
    remember: boolean;
    device?: DeviceHint;
    fingerprint?: string | null;
    ipHash?: string | null;
    userAgent?: string | null;
  },
): Promise<{ token: string; ttlMs: number; session: SessionRow }> {
  const token = generateSessionToken();
  const ttlMs = sessionTtlMs(opts.remember);
  const expiresAt = new Date(Date.now() + ttlMs);

  const [row] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      tokenHash: hashToken(token),
      status: "active",
      deviceLabel: opts.device?.label ?? opts.userAgent?.slice(0, 120) ?? null,
      deviceId: opts.device?.id ?? null,
      userAgent: opts.userAgent ?? null,
      fingerprint: opts.fingerprint ?? null,
      ipHash: opts.ipHash ?? null,
      expiresAt,
    })
    .returning();

  if (!row) {
    throw new Error("Failed to create session row.");
  }
  return { token, ttlMs, session: row };
}

export async function endSession(
  sessionId: string,
  kind: "signed_out" | "revoked",
  revokedByUserId?: string,
): Promise<SessionRow | null> {
  const [row] = await db
    .update(sessions)
    .set(
      kind === "signed_out"
        ? { status: "signed_out", signedOutAt: new Date() }
        : {
            status: "revoked",
            revokedAt: new Date(),
            revokedBy: revokedByUserId ?? null,
          },
    )
    .where(and(eq(sessions.id, sessionId), eq(sessions.status, "active")))
    .returning();
  return row ?? null;
}
