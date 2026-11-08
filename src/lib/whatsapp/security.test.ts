import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, loadEncryptionKey } from "./crypto";
import { signPayload, verifyWebhookSignature } from "./signature";

describe("webhook signature", () => {
  const secret = "app-secret-123";
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

  it("accepts a valid signature", () => {
    expect(verifyWebhookSignature(body, signPayload(body, secret), secret)).toBe(true);
  });

  it("rejects a wrong secret, a changed body, or a missing header", () => {
    const sig = signPayload(body, secret);
    expect(verifyWebhookSignature(body, signPayload(body, "other"), secret)).toBe(false);
    expect(verifyWebhookSignature(body + " ", sig, secret)).toBe(false);
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyWebhookSignature(body, "sha256=abc", secret)).toBe(false);
    expect(verifyWebhookSignature(body, sig, undefined)).toBe(false);
  });
});

describe("token encryption", () => {
  const key = randomBytes(32);

  it("round-trips a token", () => {
    const token = "EAAG" + "x".repeat(200);
    const stored = encryptToken(token, key);
    expect(stored).not.toContain(token);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(decryptToken(stored, key)).toBe(token);
  });

  it("uses a fresh IV every time", () => {
    expect(encryptToken("same", key)).not.toBe(encryptToken("same", key));
  });

  it("fails with the wrong key or a tampered value", () => {
    const stored = encryptToken("secret-token", key);
    expect(() => decryptToken(stored, randomBytes(32))).toThrow();
    const parts = stored.split(":");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 1;
    parts[3] = data.toString("base64");
    expect(() => decryptToken(parts.join(":"), key)).toThrow();
  });

  it("loads a 64-hex-character key and rejects bad keys", () => {
    expect(loadEncryptionKey("ab".repeat(32)).length).toBe(32);
    expect(() => loadEncryptionKey("short")).toThrow();
    expect(() => loadEncryptionKey("")).toThrow();
  });
});
