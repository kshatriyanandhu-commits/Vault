import { isApiError } from "./types";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Fetch JSON with credentials; throws ApiRequestError with safe messages. */
export async function apiFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    if (isApiError(payload)) {
      throw new ApiRequestError(res.status, payload.error.code, payload.error.message);
    }
    throw new ApiRequestError(
      res.status,
      "request_failed",
      res.status >= 500
        ? "Server error. Try again shortly."
        : "Request failed.",
    );
  }
  return payload as T;
}

export function postJson<T>(url: string, body?: unknown): Promise<T> {
  return apiFetch<T>(url, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function putJson<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, { method: "PUT", body: JSON.stringify(body) });
}

export function delJson<T>(url: string): Promise<T> {
  return apiFetch<T>(url, { method: "DELETE" });
}
