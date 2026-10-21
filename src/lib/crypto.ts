/**
 * Browser-side vault cryptography. Runs on WebCrypto only, so it works in every
 * modern browser — and in Node >= 18 (globalThis.crypto.subtle) for seed
 * scripts and unit tests.
 *
 * - Vault key: PBKDF2-HMAC-SHA-256 (OWASP-recommended 600k iterations) derived
 *   from the master password + a per-user salt. Never sent to the server.
 * - Credential encryption: AES-256-GCM with a fresh 12-byte random nonce per
 *   encryption and AAD binding each blob to `userId:credentialId`, so ciphertext
 *   cannot be swapped between rows or accounts.
 */

export const DEFAULT_KDF_ITERATIONS = 600_000;
export const KEY_CHECK_PLAINTEXT = "argus-vault-key-check-v1";
export const KEY_CHECK_AAD = "key-check";

const subtle = () => {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error("WebCrypto is unavailable in this environment.");
  }
  return c.subtle;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function randomBase64(bytes: number): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return bytesToBase64(buf);
}

export function bytesToBase64(bytes: Uint8Array<ArrayBufferLike>): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + chunk, bytes.length)),
    );
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Derive the AES-GCM vault key from the master password. */
export async function deriveVaultKey(
  password: string,
  kdfSaltBase64: string,
  iterations: number = DEFAULT_KDF_ITERATIONS,
): Promise<CryptoKey> {
  const salt = base64ToBytes(kdfSaltBase64);
  const material = await subtle().importKey(
    "raw",
    encoder.encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable — the raw key can never be read out of the browser
    ["encrypt", "decrypt"],
  );
}

export type EncryptedEnvelope = { ciphertext: string; iv: string };

/** Encrypt a credential record. AAD binds the blob to its owner + row id. */
export async function encryptPayload(
  key: CryptoKey,
  plaintext: unknown,
  aad: string,
): Promise<EncryptedEnvelope> {
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const ciphertext = await subtle().encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(JSON.stringify(plaintext)),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  };
}

/** Decrypt a credential record. Throws if the key, AAD, or data is wrong. */
export async function decryptPayload<T>(
  key: CryptoKey,
  envelope: EncryptedEnvelope,
  aad: string,
): Promise<T> {
  const iv = base64ToBytes(envelope.iv);
  const data = base64ToBytes(envelope.ciphertext);
  const plaintext = await subtle().decrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    data,
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

/** AAD helper shared by app code, seed scripts, and tests. */
export function credentialAad(userId: string, credentialId: string): string {
  return `${userId}:${credentialId}`;
}

/**
 * Server stores a non-secret blob the client can decrypt with a derived key to
 * confirm the master password is correct — without transmitting anything.
 */
export async function createKeyCheck(
  key: CryptoKey,
): Promise<EncryptedEnvelope> {
  return encryptPayload(key, KEY_CHECK_PLAINTEXT, KEY_CHECK_AAD);
}

export async function verifyVaultKey(
  key: CryptoKey,
  envelope: EncryptedEnvelope,
): Promise<boolean> {
  try {
    const value = await decryptPayload<string>(key, envelope, KEY_CHECK_AAD);
    return value === KEY_CHECK_PLAINTEXT;
  } catch {
    return false;
  }
}

/** Generate a fresh salt for a new account. */
export function generateKdfSalt(): string {
  return randomBase64(16);
}
