import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for WhatsApp access tokens. Server code only.
 * Stored format: "v1:<iv b64>:<auth tag b64>:<ciphertext b64>".
 * The key is TOKEN_ENCRYPTION_KEY: 32 bytes as 64 hex chars (or base64).
 */
const VERSION = "v1";

export function loadEncryptionKey(value: string | undefined = process.env.TOKEN_ENCRYPTION_KEY): Buffer {
  if (!value) throw new Error("TOKEN_ENCRYPTION_KEY is missing");
  const trimmed = value.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters)");
  }
  return key;
}

export function encryptToken(plain: string, key: Buffer = loadEncryptionKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

/** Throws if the value was tampered with or the key is wrong. */
export function decryptToken(stored: string, key: Buffer = loadEncryptionKey()): string {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== VERSION || !iv || !tag || data === undefined) {
    throw new Error("Unknown encrypted token format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
