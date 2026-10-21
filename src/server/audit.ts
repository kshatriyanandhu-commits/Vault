import { db } from "./db";
import { auditEvents } from "./db/schema";

/**
 * Audit trail writer. Only safe metadata is persisted — never passwords,
 * vault keys, session tokens, or credential ciphertext.
 * Audit failures are logged but never break the primary request.
 */

export type AuditInput = {
  event:
    | "signup"
    | "signin_success"
    | "signin_failure"
    | "signout"
    | "session_revoke"
    | "credential_create"
    | "credential_update"
    | "credential_delete";
  userId?: string | null;
  sessionId?: string | null;
  emailMasked?: string | null;
  userAgent?: string | null;
  ipHash?: string | null;
  meta?: Record<string, string | number | boolean> | null;
};

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local[0]}***@${domain}`.slice(0, 120);
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      event: input.event,
      userId: input.userId ?? null,
      sessionId: input.sessionId ?? null,
      emailMasked: input.emailMasked ?? null,
      userAgent: input.userAgent ?? null,
      ipHash: input.ipHash ?? null,
      meta: input.meta ?? null,
    });
  } catch (err) {
    console.error(
      "[argus] audit write failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
