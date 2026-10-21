import type { Category } from "./validation";
import type { EncryptedEnvelope } from "./crypto";

/** Credential record as it exists in the browser after decryption. */
export type CredentialRecord = {
  label: string;
  category: Category;
  username: string;
  password: string;
  url: string;
  notes: string;
};

/** A credential as returned by the API (encrypted at rest, opaque to server). */
export type CredentialDto = {
  id: string;
  ciphertext: string;
  iv: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  createdAt: string;
};

export type SessionDto = {
  id: string;
  status: "active" | "signed_out" | "revoked";
  signedInAt: string;
  lastSeenAt: string;
  expiresAt: string;
  signedOutAt: string | null;
  revokedAt: string | null;
  deviceLabel: string | null;
  deviceId: string | null;
  userAgent: string | null;
  fingerprint: string | null;
  ipHash: string | null;
  user: {
    id: string;
    email: string;
    name: string;
    role: "user" | "admin";
  };
  revokedByEmail: string | null;
};

export type AdminStatsDto = {
  totalUsers: number;
  totalCredentials: number;
  sessions: { active: number; signed_out: number; revoked: number };
  events24h: { signin_success: number; signin_failure: number };
  generatedAt: string;
};

export type AuditEventDto = {
  id: string;
  event: string;
  emailMasked: string | null;
  userAgent: string | null;
  ipHash: string | null;
  createdAt: string;
  userId: string | null;
  sessionId: string | null;
  meta: Record<string, string | number | boolean> | null;
};

export type SessionStatusFilterValue =
  | "all"
  | "active"
  | "signed_out"
  | "revoked";

export type ApiError = {
  error: { code: string; message: string };
};

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ApiError).error?.code === "string" &&
    typeof (value as ApiError).error?.message === "string"
  );
}

export type { EncryptedEnvelope };
