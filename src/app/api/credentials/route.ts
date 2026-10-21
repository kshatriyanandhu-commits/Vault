import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { credentials } from "@/server/db/schema";
import {
  assertSameOrigin,
  jsonOk,
  parseJsonBody,
  routeHandler,
} from "@/server/http";
import { HttpError, requireUser } from "@/server/session";
import { recordAudit } from "@/server/audit";
import { credentialEnvelopeSchema } from "@/lib/validation";
import type { CredentialDto } from "@/lib/types";

export const dynamic = "force-dynamic";

function toDto(row: typeof credentials.$inferSelect): CredentialDto {
  return {
    id: row.id,
    ciphertext: row.ciphertext,
    iv: row.iv,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * GET /api/credentials
 * Lists the *authenticated user's* encrypted credential envelopes only.
 * The server cannot read them — decryption happens in the browser.
 */
export const GET = routeHandler(async () => {
  const { user } = await requireUser();
  const rows = await db
    .select()
    .from(credentials)
    .where(eq(credentials.userId, user.id))
    .orderBy(desc(credentials.createdAt))
    .limit(500);
  return jsonOk({ credentials: rows.map(toDto) });
});

/**
 * POST /api/credentials
 * Creates a credential from a client-encrypted envelope. The id is
 * client-generated so the client could bind AAD to it before upload.
 */
export const POST = routeHandler(async (req: NextRequest) => {
  await assertSameOrigin(req);
  const { user } = await requireUser();
  const body = await parseJsonBody(req, credentialEnvelopeSchema);

  const clash = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(eq(credentials.id, body.id))
    .limit(1);
  if (clash.length > 0) {
    throw new HttpError(409, "id_taken", "Credential id already exists.");
  }

  const [row] = await db
    .insert(credentials)
    .values({
      id: body.id,
      userId: user.id,
      ciphertext: body.ciphertext,
      iv: body.iv,
    })
    .returning();
  if (!row) {
    throw new HttpError(500, "internal_error", "Could not save the credential.");
  }

  await recordAudit({
    event: "credential_create",
    userId: user.id,
    meta: { credentialId: row.id },
  });

  return jsonOk({ credential: toDto(row) }, 201);
});
