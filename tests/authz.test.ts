import { describe, expect, it, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { assertSameOrigin, HttpError } from "@/server/http";
import { maskEmail } from "@/server/audit";
import { publicUser, sessionTtlMs, SESSION_REMEMBER_TTL_MS, SESSION_TTL_MS } from "@/server/session";
import { rateLimit, resetRateLimits } from "@/server/rate-limit";
import { credentialAad, decryptPayload, deriveVaultKey, encryptPayload } from "@/lib/crypto";

afterEach(() => {
  resetRateLimits();
  vi.restoreAllMocks();
});

describe("assertSameOrigin (CSRF hardening)", () => {
  const json = { "content-type": "application/json" };

  it("accepts same-origin JSON requests", async () => {
    const req = new NextRequest("http://localhost:8080/api/auth/signin", {
      method: "POST",
      headers: { ...json, origin: "http://localhost:8080", host: "localhost:8080" },
      body: "{}",
    });
    await expect(assertSameOrigin(req)).resolves.toBeUndefined();
  });

  it("accepts requests without an Origin header (curl / same-origin fetch)", async () => {
    const req = new NextRequest("http://localhost:8080/api/auth/signin", {
      method: "POST",
      headers: json,
      body: "{}",
    });
    await expect(assertSameOrigin(req)).resolves.toBeUndefined();
  });

  it("rejects non-JSON content types on POST", async () => {
    const req = new NextRequest("http://localhost:8080/api/auth/signin", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "a=1",
    });
    await expect(assertSameOrigin(req)).rejects.toMatchObject({ status: 415 });
  });

  it("accepts bodyless POST (no content-type) — e.g. session revoke", async () => {
    const req = new NextRequest(
      "http://localhost:8080/api/admin/sessions/abc/revoke",
      { method: "POST", headers: { host: "localhost:8080" } },
    );
    await expect(assertSameOrigin(req)).resolves.toBeUndefined();
  });

  it("still rejects bodyless POST from a foreign origin", async () => {
    const req = new NextRequest(
      "http://localhost:8080/api/admin/sessions/abc/revoke",
      {
        method: "POST",
        headers: { host: "localhost:8080", origin: "https://evil.example" },
      },
    );
    await expect(assertSameOrigin(req)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects non-JSON content types on chunked POST bodies", async () => {
    const req = new NextRequest("http://localhost:8080/api/auth/signin", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "transfer-encoding": "chunked",
      },
      body: "a=1",
    });
    await expect(assertSameOrigin(req)).rejects.toMatchObject({ status: 415 });
  });

  it("allows bodyless DELETE (no content-type) from any origin header absence", async () => {
    const req = new NextRequest(
      "http://localhost:8080/api/credentials/abc",
      { method: "DELETE", headers: { host: "localhost:8080" } },
    );
    await expect(assertSameOrigin(req)).resolves.toBeUndefined();
  });

  it("still rejects DELETE from a foreign origin", async () => {
    const req = new NextRequest("http://localhost:8080/api/credentials/abc", {
      method: "DELETE",
      headers: { host: "localhost:8080", origin: "https://evil.example" },
    });
    await expect(assertSameOrigin(req)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects cross-origin requests", async () => {
    const req = new NextRequest("http://localhost:8080/api/auth/signin", {
      method: "POST",
      headers: { ...json, origin: "https://evil.example.com" },
      body: "{}",
    });
    await expect(assertSameOrigin(req)).rejects.toMatchObject({ status: 403 });
  });
});

describe("HttpError", () => {
  it("carries status + code + client-safe message", () => {
    const err = new HttpError(403, "forbidden", "Administrator access is required.");
    expect(err.status).toBe(403);
    expect(err.code).toBe("forbidden");
    expect(err.message).not.toContain("stack");
  });
});

describe("maskEmail", () => {
  it("masks the local part", () => {
    expect(maskEmail("operator@example.com")).toBe("o***@example.com");
  });

  it("handles malformed input safely", () => {
    expect(maskEmail("not-an-email")).toBe("***");
  });

  it("never returns the full address", () => {
    const masked = maskEmail("verysecretive@example.com");
    expect(masked).not.toContain("verysecretive");
  });
});

describe("publicUser projection", () => {
  it("excludes password verifier, KDF material, and key check", () => {
    const user = {
      id: "u1",
      email: "a@example.com",
      emailNormalized: "a@example.com",
      name: "A",
      role: "user" as const,
      passwordHash: "scrypt$16384$8$1$c2FsdA==$aGFzaA==",
      kdfSalt: "c2FsdHNhbHQ=",
      kdfIterations: 600000,
      keyCheck: { iv: "aXY=", ciphertext: "Y2lwaGVydGV4dA==" },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const projected = publicUser(user) as Record<string, unknown>;
    expect(Object.keys(projected).sort()).toEqual(
      ["createdAt", "email", "id", "name", "role"].sort(),
    );
    expect(JSON.stringify(projected)).not.toContain("scrypt");
    expect(JSON.stringify(projected)).not.toContain("c2FsdHNhbHQ=");
  });
});

describe("session TTLs", () => {
  it("uses 12 hours by default and 30 days when remembered", () => {
    expect(sessionTtlMs(false)).toBe(SESSION_TTL_MS);
    expect(sessionTtlMs(true)).toBe(SESSION_REMEMBER_TTL_MS);
    expect(SESSION_TTL_MS).toBe(12 * 60 * 60 * 1000);
    expect(SESSION_REMEMBER_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("rateLimit", () => {
  it("allows up to the limit then blocks within the window", () => {
    for (let i = 0; i < 5; i++) {
      expect(rateLimit("k", 5, 60_000).allowed).toBe(true);
    }
    const blocked = rateLimit("k", 5, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    const now = Date.now();
    const spy = vi.spyOn(Date, "now");
    spy.mockReturnValue(now);
    rateLimit("window", 1, 1_000);
    expect(rateLimit("window", 1, 1_000).allowed).toBe(false);
    spy.mockReturnValue(now + 2_000);
    expect(rateLimit("window", 1, 1_000).allowed).toBe(true);
  });

  it("keeps keys independent", () => {
    expect(rateLimit("a", 1, 60_000).allowed).toBe(true);
    expect(rateLimit("a", 1, 60_000).allowed).toBe(false);
    expect(rateLimit("b", 1, 60_000).allowed).toBe(true);
  });
});

describe("credential ownership binding (AAD)", () => {
  it("a ciphertext encrypted for one owner cannot be decrypted as another owner's", async () => {
    const key = await deriveVaultKey("owner-test", Buffer.alloc(16, 3).toString("base64"), 1000);
    const record = { label: "Owned", category: "login" };
    const aad = credentialAad("user-a", "cred-1");
    const envelope = await encryptPayload(key, record, aad);

    // Same row id, different owner → decrypt fails: stolen rows cannot be
    // re-attributed even if the ciphertext is copied into another user's list.
    await expect(
      decryptPayload(key, envelope, credentialAad("user-b", "cred-1")),
    ).rejects.toThrow();

    // Same owner, different row → also fails.
    await expect(
      decryptPayload(key, envelope, credentialAad("user-a", "cred-2")),
    ).rejects.toThrow();

    await expect(decryptPayload(key, envelope, aad)).resolves.toEqual(record);
  });
});
