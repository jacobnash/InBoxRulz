import { describe, expect, it } from "vitest";
import { encryptCredentials, decryptCredentials } from "./crypto.js";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

describe("credential encryption", () => {
  it("round-trips plaintext", () => {
    const plaintext = JSON.stringify({ refreshToken: "shh", accessToken: "also-shh" });
    const sealed = encryptCredentials(plaintext, TEST_KEY);
    expect(sealed).not.toContain("shh");
    expect(decryptCredentials(sealed, TEST_KEY)).toBe(plaintext);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptCredentials("same input", TEST_KEY);
    const b = encryptCredentials("same input", TEST_KEY);
    expect(a).not.toBe(b);
  });

  it("rejects a tampered payload", () => {
    const sealed = encryptCredentials("secret", TEST_KEY);
    const [iv, tag, ciphertext] = sealed.split(".");
    const tampered = [iv, tag, Buffer.from(ciphertext, "base64").reverse().toString("base64")].join(
      ".",
    );
    expect(() => decryptCredentials(tampered, TEST_KEY)).toThrow();
  });

  it("throws without a key configured", () => {
    expect(() => encryptCredentials("x", undefined)).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
  });
});
