import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Argus Vault schema.
 *
 * Security invariants encoded here:
 *  - `users.password_hash` is a scrypt password verifier (salt + params + hash).
 *    Plaintext passwords are never stored.
 *  - `users.kdf_salt` / `users.kdf_iterations` drive client-side PBKDF2 for the
 *    vault encryption key. The key itself never leaves the browser.
 *  - `users.key_check` is a *non-secret* AES-GCM blob the client can decrypt with
 *    a derived key to confirm the master password, without ever sending the key
 *    (or the password) anywhere.
 *  - `credentials.ciphertext` / `credentials.iv` are the only credential data the
 *    server ever sees: an AES-256-GCM payload (ciphertext||tag) plus a fresh
 *    12-byte nonce. No plaintext, no key material.
 *  - `sessions` track status + timestamps + privacy-conscious metadata. IPs are
 *    stored only as salted hashes; fingerprints are client-reported hints and are
 *    never treated as identity.
 *  - `audit_events` contain only safe metadata (no secrets, no ciphertext).
 */

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const sessionStatusEnum = pgEnum("session_status", [
  "active",
  "signed_out",
  "revoked",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Display email, as provided. */
    email: text("email").notNull(),
    /** Lower-cased/trimmed email used for lookups and uniqueness. */
    emailNormalized: text("email_normalized").notNull(),
    name: text("name").notNull(),
    role: userRoleEnum("role").notNull().default("user"),
    /** scrypt verifier: `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>` */
    passwordHash: text("password_hash").notNull(),
    /** Base64 salt for the client-side PBKDF2 vault-key derivation. */
    kdfSalt: text("kdf_salt").notNull(),
    kdfIterations: integer("kdf_iterations").notNull(),
    /** Non-secret client-verifiable blob proving a derived key is correct. */
    keyCheck: jsonb("key_check")
      .$type<{ iv: string; ciphertext: string }>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("users_email_normalized_idx").on(t.emailNormalized),
  ],
);

export const credentials = pgTable(
  "credentials",
  {
    /** Client-generated UUID so the client can bind AAD to the id before upload. */
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Base64 AES-256-GCM ciphertext||tag of the whole credential record. */
    ciphertext: text("ciphertext").notNull(),
    /** Base64 12-byte GCM nonce, fresh per encryption. */
    iv: text("iv").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("credentials_user_idx").on(t.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the opaque session token stored in the httpOnly cookie. */
    tokenHash: text("token_hash").notNull(),
    status: sessionStatusEnum("status").notNull().default("active"),
    /** Client-provided display label ("Chrome on Windows"). Untrusted hint. */
    deviceLabel: text("device_label"),
    /** Client "remember this device" id. Untrusted display hint, never auth. */
    deviceId: text("device_id"),
    /** Server-observed User-Agent header. */
    userAgent: text("user_agent"),
    /** Client-reported coarse fingerprint. Untrusted, display only. */
    fingerprint: text("fingerprint"),
    /** SHA-256(ip + SESSION_PEPPER), truncated. Raw IPs are never stored. */
    ipHash: text("ip_hash"),
    signedInAt: timestamp("signed_in_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    signedOutAt: timestamp("signed_out_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    index("sessions_status_idx").on(t.status),
    index("sessions_last_seen_idx").on(t.lastSeenAt),
    uniqueIndex("sessions_token_hash_idx").on(t.tokenHash),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    /** e.g. signup, signin_success, signin_failure, signout, session_revoke */
    event: text("event").notNull(),
    /** Masked email (a***@example.com) for failure events; never a password. */
    emailMasked: text("email_masked"),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
    /** Safe metadata only (counts, ids). Never secrets or ciphertext. */
    meta: jsonb("meta").$type<Record<string, string | number | boolean> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("audit_events_event_created_idx").on(t.event, t.createdAt),
    index("audit_events_user_idx").on(t.userId),
    index("audit_events_created_idx").on(t.createdAt),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type CredentialRow = typeof credentials.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;

/** Guard against accidental empty-table renames in migrations. */
export const schemaVersion = sql`1`;
