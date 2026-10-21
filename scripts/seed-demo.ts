import "./env";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sql } from "@/server/db";
import { credentials, users } from "@/server/db/schema";
import { hashPassword } from "@/server/password";
import {
  createKeyCheck,
  credentialAad,
  deriveVaultKey,
  encryptPayload,
  generateKdfSalt,
  DEFAULT_KDF_ITERATIONS,
} from "@/lib/crypto";
import type { CredentialRecord } from "@/lib/types";

/**
 * Seeds a demo account with sample credentials. Everything is encrypted with
 * the same browser-equivalent WebCrypto code path the app uses, so the server
 * only ever receives ciphertext — exactly like real usage.
 * Run: npm run db:seed:demo
 */

const SAMPLES: CredentialRecord[] = [
  {
    label: "Production AWS (root)",
    category: "server",
    username: "root-admin",
    password: "Zt7#vaultDemo!awsRoot2049",
    url: "https://console.aws.amazon.com",
    notes: "MFA on hardware key. Rotate every 90 days.\nBreak-glass contact: sre-oncall.",
  },
  {
    label: "GitHub — org owner",
    category: "login",
    username: "demo-operator",
    password: "gh_demo_Phrase-9281-Metal",
    url: "https://github.com",
    notes: "SSO via Okta for employees; PAT scoped to repo automation only.",
  },
  {
    label: "Corporate bank — treasury",
    category: "bank",
    username: "demo.operator@example.com",
    password: "Tr#9vAultD3mo!bank",
    url: "https://bank.example.com",
    notes: "Dual-approval above $10,000. Token device stored in safe deposit.",
  },
  {
    label: "Business Visa •4111",
    category: "card",
    username: "4111 1111 1111 1111",
    password: "913",
    url: "",
    notes: "Exp 04/29. Monthly limit $5,000. Report loss to issuer immediately.",
  },
  {
    label: "Office alarm — floor 4",
    category: "identity",
    username: "zone-4",
    password: "482916",
    url: "",
    notes: "Duress code differs; see paper binder in the safe.",
  },
];

function mask(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***@${email.slice(at + 1)}`;
}

async function main() {
  const email = (process.env.DEMO_EMAIL ?? "demo@argus.local").trim().toLowerCase();
  const name = process.env.DEMO_NAME ?? "Demo Operator";
  const password = process.env.DEMO_PASSWORD ?? "";

  if (!password) {
    console.error("DEMO_PASSWORD must be set (see .env.example).");
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("DEMO_PASSWORD must be at least 10 characters.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const kdfSalt = generateKdfSalt();
  const kdfIterations = DEFAULT_KDF_ITERATIONS;
  const key = await deriveVaultKey(password, kdfSalt, kdfIterations);
  const keyCheck = await createKeyCheck(key);

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.emailNormalized, email))
    .limit(1);

  let userId: string;
  if (existing[0]) {
    userId = existing[0].id;
    await db
      .update(users)
      .set({
        name,
        passwordHash,
        kdfSalt,
        kdfIterations,
        keyCheck,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    // Demo data is regenerated from scratch on every seed run.
    await db.delete(credentials).where(eq(credentials.userId, userId));
    console.log(`✓ Reset demo account ${mask(email)} and its credentials.`);
  } else {
    const [row] = await db
      .insert(users)
      .values({
        email,
        emailNormalized: email,
        name,
        role: "user",
        passwordHash,
        kdfSalt,
        kdfIterations,
        keyCheck,
      })
      .returning({ id: users.id });
    userId = row!.id;
    console.log(`✓ Created demo account ${mask(email)}.`);
  }

  for (const record of SAMPLES) {
    const id = randomUUID();
    const envelope = await encryptPayload(
      key,
      record,
      credentialAad(userId, id),
    );
    await db.insert(credentials).values({
      id,
      userId,
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
    });
  }

  console.log(`✓ Sealed ${SAMPLES.length} encrypted sample credentials.`);
  console.log("  Sign in at http://localhost:8080 with the DEMO_PASSWORD you configured.");
}

main()
  .catch((err) => {
    console.error("Demo seed failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
    process.exit();
  });
