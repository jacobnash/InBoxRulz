import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

/**
 * Envelope encryption for credentials at rest (OAuth token sets, IMAP
 * app-passwords). AES-256-GCM with a random 12-byte IV per value; the IV and
 * auth tag are stored alongside the ciphertext so each encrypted blob is
 * self-contained and safe to persist as a single opaque string.
 *
 * The master key should come from a KMS-backed secret in production
 * (spec section 9); here it's read from an env var so this package has no
 * cloud-provider dependency baked in.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function loadMasterKey(masterKey?: string): Buffer {
  const raw = masterKey ?? process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32`.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Generate one with \`openssl rand -base64 32\`.`,
    );
  }
  return key;
}

export function encryptCredentials(plaintext: string, masterKey?: string): string {
  const key = loadMasterKey(masterKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(
    ".",
  );
}

export function decryptCredentials(sealed: string, masterKey?: string): string {
  const key = loadMasterKey(masterKey);
  const [ivB64, authTagB64, ciphertextB64] = sealed.split(".");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Malformed encrypted credentials payload.");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
