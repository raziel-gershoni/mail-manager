import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "../../src/lib/crypto.js";

const key = randomBytes(32).toString("base64");

describe("crypto round trip", () => {
  it("decrypts what it encrypts", () => {
    const enc = encryptSecret("refresh-token-123", key);
    expect(enc).not.toContain("refresh-token-123");
    expect(decryptSecret(enc, key)).toBe("refresh-token-123");
  });
  it("fails to decrypt with a different key", () => {
    const enc = encryptSecret("x", key);
    const other = randomBytes(32).toString("base64");
    expect(() => decryptSecret(enc, other)).toThrow();
  });
});
