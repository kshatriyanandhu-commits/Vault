import { describe, expect, it } from "vitest";
import {
  adminSessionsQuerySchema,
  credentialEnvelopeSchema,
  credentialInputSchema,
  emailSchema,
  masterPasswordSchema,
  signinSchema,
  signupSchema,
  toIlikePattern,
} from "@/lib/validation";

describe("emailSchema", () => {
  it("lowercases and trims valid emails", () => {
    const result = emailSchema.parse("  Operator@Example.COM ");
    expect(result).toBe("operator@example.com");
  });

  it("rejects malformed emails", () => {
    for (const bad of ["", "no-at-sign", "a@b", "@example.com", "a b@example.com"]) {
      expect(emailSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("bounds length", () => {
    const long = `${"a".repeat(250)}@example.com`;
    expect(emailSchema.safeParse(long).success).toBe(false);
  });
});

describe("masterPasswordSchema", () => {
  it("requires at least 10 characters and caps at 200", () => {
    expect(masterPasswordSchema.safeParse("short").success).toBe(false);
    expect(masterPasswordSchema.safeParse("a".repeat(9)).success).toBe(false);
    expect(masterPasswordSchema.safeParse("a".repeat(10)).success).toBe(true);
    expect(masterPasswordSchema.safeParse("a".repeat(201)).success).toBe(false);
  });
});

describe("signupSchema", () => {
  const valid = {
    email: "new@example.com",
    name: "New User",
    password: "correct horse battery",
    kdfSalt: Buffer.alloc(16, 7).toString("base64"),
    keyCheck: {
      iv: Buffer.alloc(12, 1).toString("base64"),
      ciphertext: Buffer.alloc(32, 2).toString("base64"),
    },
  };

  it("accepts a well-formed payload", () => {
    expect(signupSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unknown keys such as a client-supplied role", () => {
    // Strict schemas reject `role` outright — public signup can never set it.
    const withRole = { ...valid, role: "admin" };
    const result = signupSchema.safeParse(withRole);
    expect(result.success).toBe(false);
  });

  it("rejects malformed key material", () => {
    expect(
      signupSchema.safeParse({ ...valid, kdfSalt: "not base64!!!" }).success,
    ).toBe(false);
    expect(
      signupSchema.safeParse({ ...valid, keyCheck: { ...valid.keyCheck, iv: "AA" } })
        .success,
    ).toBe(false);
  });

  it("bounds the name field", () => {
    expect(
      signupSchema.safeParse({ ...valid, name: "x".repeat(81) }).success,
    ).toBe(false);
  });
});

describe("signinSchema", () => {
  it("defaults remember to false and rejects unknown keys", () => {
    const parsed = signinSchema.parse({
      email: "a@example.com",
      password: "hunter2hunter2",
    });
    expect(parsed.remember).toBe(false);
    expect(
      signinSchema.safeParse({
        email: "a@example.com",
        password: "hunter2hunter2",
        role: "admin",
      }).success,
    ).toBe(false);
  });

  it("requires a password", () => {
    expect(
      signinSchema.safeParse({ email: "a@example.com", password: "" }).success,
    ).toBe(false);
  });
});

describe("credentialInputSchema", () => {
  const valid = {
    label: "Prod DB",
    category: "server",
    username: "admin",
    password: "s3cret",
    url: "https://db.example.com",
    notes: "rotate monthly",
  };

  it("accepts a valid record and defaults optional fields", () => {
    const parsed = credentialInputSchema.parse({ label: "x", category: "login" });
    expect(parsed.username).toBe("");
    expect(parsed.password).toBe("");
    expect(parsed.notes).toBe("");
  });

  it("rejects unknown categories and missing labels", () => {
    expect(credentialInputSchema.safeParse({ ...valid, category: "crypto" }).success).toBe(false);
    expect(credentialInputSchema.safeParse({ ...valid, label: "   " }).success).toBe(false);
  });

  it("bounds field lengths", () => {
    expect(credentialInputSchema.safeParse({ ...valid, label: "x".repeat(121) }).success).toBe(false);
    expect(credentialInputSchema.safeParse({ ...valid, notes: "x".repeat(4001) }).success).toBe(false);
    expect(credentialInputSchema.safeParse({ ...valid, username: "x".repeat(201) }).success).toBe(false);
  });

  it("allows empty urls but validates shape when present", () => {
    expect(credentialInputSchema.safeParse({ ...valid, url: "" }).success).toBe(true);
    expect(credentialInputSchema.safeParse({ ...valid, url: "https://ok.example" }).success).toBe(true);
  });
});

describe("credentialEnvelopeSchema", () => {
  const valid = {
    id: "3f1a5b0c-9d2e-4f6a-8b1c-0d2e3f4a5b6c",
    ciphertext: Buffer.alloc(48, 3).toString("base64"),
    iv: Buffer.alloc(12, 4).toString("base64"),
  };

  it("accepts a valid envelope", () => {
    expect(credentialEnvelopeSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects non-uuid ids, short ciphertexts, and wrong nonce lengths", () => {
    expect(credentialEnvelopeSchema.safeParse({ ...valid, id: "nope" }).success).toBe(false);
    expect(credentialEnvelopeSchema.safeParse({ ...valid, ciphertext: "abc" }).success).toBe(false);
    const badIv = Buffer.alloc(11, 4).toString("base64");
    expect(credentialEnvelopeSchema.safeParse({ ...valid, iv: badIv }).success).toBe(false);
  });
});

describe("adminSessionsQuerySchema", () => {
  it("coerces and bounds the limit", () => {
    expect(adminSessionsQuerySchema.parse({ limit: "25" }).limit).toBe(25);
    expect(adminSessionsQuerySchema.safeParse({ limit: "5000" }).success).toBe(false);
    expect(adminSessionsQuerySchema.safeParse({ limit: "-1" }).success).toBe(false);
  });

  it("validates the status filter", () => {
    expect(adminSessionsQuerySchema.parse({ status: "revoked" }).status).toBe("revoked");
    expect(adminSessionsQuerySchema.safeParse({ status: "nonsense" }).success).toBe(false);
  });
});

describe("toIlikePattern", () => {
  it("escapes LIKE wildcards", () => {
    expect(toIlikePattern("100%_x")).toBe("%100\\%\\_x%");
  });
});
