import { describe, it, expect } from "vitest";
import { isNoGoogleAccount } from "../../src/oauth/google.js";

describe("isNoGoogleAccount", () => {
  it("matches the 'no google account linked' error authedGmailFor throws", () => {
    expect(isNoGoogleAccount(new Error("no google account linked"))).toBe(true);
  });
  it("is false for other errors", () => {
    expect(isNoGoogleAccount(new Error("network timeout"))).toBe(false);
    expect(isNoGoogleAccount({ code: 404 })).toBe(false);
    expect(isNoGoogleAccount(null)).toBe(false);
  });
});
