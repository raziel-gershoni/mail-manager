// tests/telegram/allowlist.test.ts
import { describe, it, expect } from "vitest";
import { isAllowed } from "../../src/telegram/bot.js";

describe("isAllowed", () => {
  it("returns true when fromId matches ownerId", () => {
    expect(isAllowed(42, 42)).toBe(true);
  });
  it("returns false when fromId does not match ownerId", () => {
    expect(isAllowed(42, 7)).toBe(false);
  });
  it("returns false when fromId is undefined", () => {
    expect(isAllowed(42, undefined)).toBe(false);
  });
});
