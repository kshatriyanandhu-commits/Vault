import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
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

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PUT /api/credentials/[id]
 * Ownership is enforced in the WHERE clause itself: updates only match rows
 * belonging to the authenticated user, so a foreign id is a 404 (no oracle).
 */
export const PUT = routeHandler(async (req: NextRequest, ctx?: unknown) => {
  await assertSameOrigin(req);
  const { user } = await requireUser();
  const { id } = await (ctx as RouteContext).params;
  if (!isUuid(id)) {
    throw new HttpError(400, "invalid_id", "Credential id must be a UUID.");
  }
  const body = await parseJsonBody(req, credentialEnvelopeSchema);
  if (body.id !== id) {
    throw new HttpError(400, "invalid_id", "Credential id mismatch.");
  }

  const [row] = await db
    .update(credentials)
    .set({ ciphertext: body.ciphertext, iv: body.iv, updatedAt: new Date() })
    .where(and(eq(credentials.id, id), eq(credentials.userId, user.id)))
    .returning();
  if (!row) {
    throw new HttpError(404, "not_found", "Credential not found.");
  }

  await recordAudit({
    event: "credential_update",
    userId: user.id,
    meta: { credentialId: row.id },
  });

  return jsonOk({
    credential: {
      id: row.id,
      ciphertext: row.ciphertext,
      iv: row.iv,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  });
});

/** DELETE /api/credentials/[id] */
export const DELETE = routeHandler(async (req: NextRequest, ctx?: unknown) => {
  await assertSameOrigin(req);
  const { user } = await requireUser();
  const { id } = await (ctx as RouteContext).params;
  if (!isUuid(id)) {
    throw new HttpError(400, "invalid_id", "Credential id must be a UUID.");
  }

  const [row] = await db
    .delete(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.userId, user.id)))
    .returning({ id: credentials.id });
  if (!row) {
    throw new HttpError(404, "not_found", "Credential not found.");
  }

  await recordAudit({
    event: "credential_delete",
    userId: user.id,
    meta: { credentialId: row.id },
  });

  return jsonOk({ ok: true });
});

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
