import { scryptAsync } from "@noble/hashes/scrypt.js";
import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Master-password verifier.
 *
 * Algorithm: scrypt (RFC 7914) from @noble/hashes — an audited, dependency-free
 * implementation maintained by the same team behind @noble/ciphers. scrypt is
 * memory-hard and is on the OWASP password-storage shortlist; parameters below
 * correspond to ~32 MiB of memory per hash (N=2^15, r=8, p=1), a practical
 * server-side cost while still being resistant to GPU cracking.
 *
 * Format: `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>` (self-describing, upgradeable).
 * Plaintext passwords are never stored, logged, or returned.
 */

export const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, dkLen: 32 } as const;

export type ScryptParams = {
  N: number;
  r: number;
  p: number;
  dkLen: number;
};

function b64(buf: Uint8Array): string {
  return Buffer.from(buf).toString("base64");
}

export async function hashPassword(
  password: string,
  params: ScryptParams = SCRYPT_PARAMS,
): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize("NFKC"), salt, params);
  return [
    "scrypt",
    params.N,
    params.r,
    params.p,
    b64(salt),
    Buffer.from(hash).toString("base64"),
  ].join("$");
}

/** Constant-time verification of a stored verifier against a candidate password. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  // Bound parameters from stored data so a tampered row can't exhaust memory.
  if (N < 1024 || N > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (salt.length < 8 || expected.length < 16) return false;
  const actual = await scryptAsync(password.normalize("NFKC"), salt, {
    N,
    r,
    p,
    dkLen: expected.length,
  });
  return timingSafeEqual(Buffer.from(actual), expected);
}

/**
 * Burn roughly the same CPU time as a real verification when the account does
 * not exist, to reduce user-enumeration timing signal.
 */
export async function dummyVerify(): Promise<void> {
  await scryptAsync("not-a-real-password", randomBytes(16), {
    ...SCRYPT_PARAMS,
    N: 1 << 14, // slightly cheaper; still tens of ms
  });
}
