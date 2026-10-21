import { describe, expect, it } from "vitest";
import {
  createKeyCheck,
  credentialAad,
  decryptPayload,
  deriveVaultKey,
  encryptPayload,
  generateKdfSalt,
  verifyVaultKey,
  DEFAULT_KDF_ITERATIONS,
} from "@/lib/crypto";
import type { CredentialRecord } from "@/lib/types";

// Light iterations keep the suite fast; behavior is identical.
const ITER = 1000;
const salt = generateKdfSalt();
const sample: CredentialRecord = {
  label: "Prod DB",
  category: "server",
  username: "admin",
  password: "s3cret-pw",
  url: "https://db.example.com",
  notes: "rotate",
};

async function keyFor(password: string, s: string = salt) {
  return deriveVaultKey(password, s, ITER);
}

describe("deriveVaultKey", () => {
  it("is deterministic for the same password + salt", async () => {
    const a = await keyFor("password-one");
    const b = await keyFor("password-one");
    // Non-extractable keys cannot be compared directly; prove equality by
    // decrypting a blob made with one key using the other.
    const env = await encryptPayload(a, sample, "aad");
    const roundTrip = await decryptPayload<CredentialRecord>(b, env, "aad");
    expect(roundTrip).toEqual(sample);
  });

  it("produces non-extractable AES-GCM keys", async () => {
    const key = await keyFor("password-one");
    expect(key.type).toBe("secret");
    expect(key.algorithm.name).toBe("AES-GCM");
    expect(key.extractable).toBe(false);
  });

  it("derives different keys for different salts", async () => {
    const a = await keyFor("password-one", generateKdfSalt());
    const b = await keyFor("password-one", generateKdfSalt());
    const env = await encryptPayload(a, sample, "aad");
    await expect(decryptPayload(b, env, "aad")).rejects.toThrow();
  });

  it("has a sane default iteration count", () => {
    expect(DEFAULT_KDF_ITERATIONS).toBe(600_000);
  });
});

describe("encryptPayload / decryptPayload", () => {
  it("round-trips arbitrary credential records", async () => {
    const key = await keyFor("round-trip");
    const env = await encryptPayload(key, sample, "u:c");
    const out = await decryptPayload<CredentialRecord>(key, env, "u:c");
    expect(out).toEqual(sample);
  });

  it("uses a fresh nonce per encryption", async () => {
    const key = await keyFor("nonce");
    const a = await encryptPayload(key, sample, "aad");
    const b = await encryptPayload(key, sample, "aad");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(Buffer.from(a.iv, "base64")).toHaveLength(12);
  });

  it("rejects the wrong key", async () => {
    const keyA = await keyFor("key-a");
    const keyB = await keyFor("key-b");
    const env = await encryptPayload(keyA, sample, "aad");
    await expect(decryptPayload(keyB, env, "aad")).rejects.toThrow();
  });

  it("enforces AAD binding (ciphertext cannot change owners)", async () => {
    const key = await keyFor("aad");
    const env = await encryptPayload(key, sample, "user-1:cred-1");
    await expect(decryptPayload(key, env, "user-2:cred-1")).rejects.toThrow();
    await expect(decryptPayload(key, env, "user-1:cred-2")).rejects.toThrow();
    const ok = await decryptPayload(key, env, "user-1:cred-1");
    expect(ok).toEqual(sample);
  });

  it("detects tampered ciphertext", async () => {
    const key = await keyFor("tamper");
    const env = await encryptPayload(key, sample, "aad");
    const bytes = Buffer.from(env.ciphertext, "base64");
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    await expect(
      decryptPayload(key, { ...env, ciphertext: bytes.toString("base64") }, "aad"),
    ).rejects.toThrow();
  });

  it("detects a tampered nonce", async () => {
    const key = await keyFor("tamper-iv");
    const env = await encryptPayload(key, sample, "aad");
    const iv = Buffer.from(env.iv, "base64");
    iv[0] ^= 0xff;
    await expect(
      decryptPayload(key, { ...env, iv: iv.toString("base64") }, "aad"),
    ).rejects.toThrow();
  });
});

describe("credentialAad", () => {
  it("binds user and credential ids", () => {
    expect(credentialAad("u1", "c1")).toBe("u1:c1");
    expect(credentialAad("u1", "c2")).not.toBe(credentialAad("u2", "c2"));
  });
});

describe("key check", () => {
  it("verifies the correct key and rejects wrong ones", async () => {
    const key = await keyFor("key-check");
    const check = await createKeyCheck(key);
    expect(await verifyVaultKey(key, check)).toBe(true);

    const wrong = await keyFor("different");
    expect(await verifyVaultKey(wrong, check)).toBe(false);
  });

  it("rejects a corrupted key-check blob", async () => {
    const key = await keyFor("corrupt");
    const check = await createKeyCheck(key);
    expect(
      await verifyVaultKey(key, {
        ...check,
        ciphertext: Buffer.alloc(32, 9).toString("base64"),
      }),
    ).toBe(false);
  });
});
