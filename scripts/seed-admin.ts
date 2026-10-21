import "./env";
import { eq } from "drizzle-orm";
import { db, sql } from "@/server/db";
import { users } from "@/server/db/schema";
import { hashPassword } from "@/server/password";
import {
  createKeyCheck,
  deriveVaultKey,
  generateKdfSalt,
  DEFAULT_KDF_ITERATIONS,
} from "@/lib/crypto";

/**
 * Provisions (or promotes) the administrator account from environment config:
 *   ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD
 *
 * This is the ONLY path to an admin account — public sign-up always creates
 * role "user". The script stores a scrypt verifier plus the client-style KDF
 * material, so the admin can also use the personal vault like anyone else.
 * Run: npm run db:seed:admin
 */

function mask(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***@${email.slice(at + 1)}`;
}

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const name = (process.env.ADMIN_NAME ?? "").trim() || "Argus Administrator";
  const password = process.env.ADMIN_PASSWORD ?? "";

  if (!email || !password) {
    console.error(
      "ADMIN_EMAIL and ADMIN_PASSWORD must be set (see .env.example).",
    );
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("ADMIN_PASSWORD must be at least 10 characters.");
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

  if (existing[0]) {
    await db
      .update(users)
      .set({
        role: "admin",
        name,
        passwordHash,
        kdfSalt,
        kdfIterations,
        keyCheck,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing[0].id));
    console.log(
      `✓ Promoted ${mask(email)} to admin and rotated verifier + KDF material.`,
    );
  } else {
    await db.insert(users).values({
      email,
      emailNormalized: email,
      name,
      role: "admin",
      passwordHash,
      kdfSalt,
      kdfIterations,
      keyCheck,
    });
    console.log(`✓ Created admin account ${mask(email)} (role: admin).`);
  }

  console.log(
    "  Sign in at http://localhost:8080 with the ADMIN_PASSWORD you configured.",
  );
}

main()
  .catch((err) => {
    console.error("Admin seed failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
    process.exit();
  });
