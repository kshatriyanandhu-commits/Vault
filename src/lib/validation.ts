import { z } from "zod";

/**
 * Shared validation schemas (used by API routes and mirrored by the UI).
 * Everything is bounded: max lengths everywhere, enumerated categories,
 * strict JSON parsing (`strip` for auth bodies so a client-supplied `role`
 * can never reach the database).
 */

export const CATEGORIES = [
  "login",
  "bank",
  "card",
  "identity",
  "server",
  "note",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  login: "Login",
  bank: "Banking",
  card: "Card",
  identity: "Identity",
  server: "Server",
  note: "Secure note",
  other: "Other",
};

export const emailSchema = z
  .string()
  .trim()
  .min(3, "Email is required.")
  .max(254, "Email is too long.")
  .email("Enter a valid email address.")
  .transform((v) => v.toLowerCase());

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(80, "Name must be 80 characters or fewer.");

export const masterPasswordSchema = z
  .string()
  .min(10, "Master password must be at least 10 characters.")
  .max(200, "Master password must be 200 characters or fewer.");

/** Strips unknown keys — `role` from public signup input is ignored by design. */
export const signupSchema = z
  .object({
    email: emailSchema,
    name: nameSchema,
    password: masterPasswordSchema,
    kdfSalt: z
      .string()
      .min(16)
      .max(256)
      .regex(/^[A-Za-z0-9+/=]+$/, "kdfSalt must be base64."),
    keyCheck: z
      .object({
        iv: z
          .string()
          .min(8)
          .max(64)
          .regex(/^[A-Za-z0-9+/=]+$/, "iv must be base64."),
        ciphertext: z
          .string()
          .min(16)
          .max(4096)
          .regex(/^[A-Za-z0-9+/=]+$/, "ciphertext must be base64."),
      })
      .strict(),
    device: z
      .object({
        id: z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
        label: z.string().trim().min(1).max(120),
      })
      .strict()
      .optional(),
    fingerprint: z.string().trim().max(200).optional(),
  })
  .strict();

export const signinSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, "Master password is required.").max(200),
    remember: z.boolean().optional().default(false),
    device: z
      .object({
        id: z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
        label: z.string().trim().min(1).max(120),
      })
      .strict()
      .optional(),
    fingerprint: z.string().trim().max(200).optional(),
  })
  .strict();

export const unlockSchema = z
  .object({
    password: z.string().min(1, "Master password is required.").max(200),
  })
  .strict();

/** Plaintext credential shape, validated client-side *before* encryption. */
export const credentialInputSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, "Label is required.")
      .max(120, "Label must be 120 characters or fewer."),
    category: z.enum(CATEGORIES),
    username: z.string().trim().max(200, "Username is too long.").default(""),
    password: z.string().max(4000, "Secret is too long.").default(""),
    url: z
      .string()
      .trim()
      .max(500, "URL is too long.")
      .default("")
      .refine(
        (v) => v === "" || /^https?:\/\/\S+$/i.test(v) || v.length <= 200,
        "Enter a valid URL.",
      ),
    notes: z.string().max(4000, "Notes must be 4000 characters or fewer.").default(""),
  })
  .strict();

/** Wire format: the encrypted envelope uploaded to the server. */
export const credentialEnvelopeSchema = z
  .object({
    id: z.string().uuid("Credential id must be a UUID."),
    ciphertext: z
      .string()
      .min(24)
      .max(64 * 1024, "Encrypted payload is too large.")
      .regex(/^[A-Za-z0-9+/=]+$/, "ciphertext must be base64."),
    iv: z
      .string()
      .regex(
        /^[A-Za-z0-9+/]{16}$/,
        "iv must be a base64 12-byte nonce (16 chars, no padding).",
      ),
  })
  .strict();

export const sessionStatusFilterSchema = z
  .enum(["active", "signed_out", "revoked", "all"])
  .default("all");

export const adminSessionsQuerySchema = z
  .object({
    search: z.string().trim().max(200).default(""),
    status: sessionStatusFilterSchema,
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

/** Escape user input before embedding in an ILIKE pattern. */
export function toIlikePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}
