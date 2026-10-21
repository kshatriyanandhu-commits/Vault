import { describe, expect, it } from "vitest";
import { dummyVerify, hashPassword, verifyPassword } from "@/server/password";

// Cheap params keep the suite fast; the code path is identical.
const LIGHT = { N: 1 << 12, r: 8, p: 1, dkLen: 32 };

describe("hashPassword / verifyPassword", () => {
  it("round-trips the correct password", async () => {
    const stored = await hashPassword("correct horse battery staple", LIGHT);
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects wrong passwords", async () => {
    const stored = await hashPassword("correct horse battery staple", LIGHT);
    expect(await verifyPassword("correct horse battery stapl", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("produces self-describing, salted verifiers", async () => {
    const a = await hashPassword("same password", LIGHT);
    const b = await hashPassword("same password", LIGHT);
    expect(a).not.toBe(b); // fresh salt each time
    expect(a.split("$")[0]).toBe("scrypt");
    expect(Number(a.split("$")[1])).toBe(LIGHT.N);
    // Neither hash nor salt reveals the password.
    expect(a).not.toContain("same password");
  });

  it("normalizes unicode passwords consistently", async () => {
    const composed = "passwörd-ünïcode";
    const stored = await hashPassword(composed, LIGHT);
    expect(await verifyPassword(composed, stored)).toBe(true);
  });

  it("rejects malformed stored verifiers without throwing", async () => {
    for (const bad of [
      "",
      "not-a-verifier",
      "scrypt$bad$8$1$c2FsdA==$aGFzaA==",
      "bcrypt$16384$8$1$c2FsdA==$aGFzaA==",
      "scrypt$16384$8$1$short$also-short",
    ]) {
      expect(await verifyPassword("anything", bad)).toBe(false);
    }
  });

  it("bounds parameters from stored data (no memory exhaustion)", async () => {
    // A tampered row claiming absurd scrypt parameters must be refused.
    const evil = `scrypt$${1 << 25}$64$16$c2FsdHNhbHRzYWx0$c29tZWhhc2g=`;
    expect(await verifyPassword("anything", evil)).toBe(false);
  });

  it("dummyVerify always resolves", async () => {
    await expect(dummyVerify()).resolves.toBeUndefined();
  });
});
