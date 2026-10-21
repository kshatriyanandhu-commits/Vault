import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";

/** Typed HTTP error understood by `routeHandler`; message is client-safe. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(extra ?? {}) } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export function jsonOk<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * CSRF hardening for cookie-authenticated mutations:
 *  - POST (the only method an HTML form can send cross-site) must carry a JSON
 *    content type — cross-site forms cannot set it without a CORS preflight.
 *  - If an Origin header is present, it must match the request host on every
 *    mutating method. Cross-origin PUT/DELETE are additionally blocked by
 *    CORS preflight, which this server never opts into.
 * SameSite=Lax on the session cookie is the primary defense; this is defense
 * in depth. Requests without an Origin header (same-origin fetches, curl)
 * are allowed — the session cookie still must be valid.
 */
export async function assertSameOrigin(req: NextRequest): Promise<void> {
  if (req.method === "POST" || req.method === "PATCH") {
    // If the request declares a content type, it must be JSON: an HTML form
    // always declares one (urlencoded or multipart), so form-based CSRF is
    // still rejected with 415. Body-less POSTs (e.g. session revoke) declare
    // none and carry no payload to forge; the SameSite cookie and the Origin
    // check below are their defense.
    const contentType = req.headers.get("content-type");
    if (
      contentType !== null &&
      !contentType.toLowerCase().includes("application/json")
    ) {
      throw new HttpError(
        415,
        "unsupported_media_type",
        "Requests must be sent as JSON.",
      );
    }
  }
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new HttpError(403, "bad_origin", "Cross-origin requests are not allowed.");
    }
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!originHost || !host || originHost !== host) {
      throw new HttpError(
        403,
        "bad_origin",
        "Cross-origin requests are not allowed.",
      );
    }
  }
}

/** Parse + validate a request body, converting ZodError into a 400 response. */
export async function parseJsonBody<T>(
  req: NextRequest,
  schema: ZodType<T>,
  maxBytes = 128 * 1024,
): Promise<T> {
  const raw = await req.text();
  if (raw.length > maxBytes) {
    throw new HttpError(413, "payload_too_large", "Request body is too large.");
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  const result = schema.safeParse(parsedJson);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new HttpError(
      400,
      "validation_failed",
      first
        ? `${first.path.join(".") || "body"}: ${first.message}`
        : "Invalid request body.",
    );
  }
  return result.data;
}

/** Wrap a route handler with consistent error handling. */
export function routeHandler(
  handler: (req: NextRequest, ctx?: unknown) => Promise<NextResponse>,
): (req: NextRequest, ctx?: unknown) => Promise<NextResponse> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        return jsonError(err.status, err.code, err.message);
      }
      // Never leak internals (SQL, stack traces, ciphertext) to clients.
      console.error(
        `[argus] unhandled route error ${req.method} ${req.nextUrl.pathname}:`,
        err instanceof Error ? err.message : err,
      );
      return jsonError(500, "internal_error", "Something went wrong. Try again.");
    }
  };
}
