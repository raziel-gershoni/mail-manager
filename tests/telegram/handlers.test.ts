// tests/telegram/handlers.test.ts
import { describe, it, expect } from "vitest";
import { isAllowed, handleCallback } from "../../src/telegram/bot.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeSeenRepo } from "../../src/notifier/sync.js";

describe("isAllowed", () => {
  it("permits only the owner id", () => {
    expect(isAllowed(42, 42)).toBe(true);
    expect(isAllowed(42, 7)).toBe(false);
    expect(isAllowed(42, undefined)).toBe(false);
  });
});

describe("handleCallback", () => {
  const make = () => {
    const store = inMemoryStore();
    const deps = { store, seen: fakeSeenRepo(), userId: 1,
      gmailFromEmail: async (id: string) => (id === "a1" ? "n@linkedin.com" : "ceo@acme.com") };
    return { store, deps };
  };
  it("ni: mutes the sender as unimportant", async () => {
    const { store, deps } = make();
    const r = await handleCallback("ni:a1", deps);
    expect(r.reply).toMatch(/muting/i);
    expect(store.findRuleFor("n@linkedin.com","linkedin.com")?.verdict).toBe("unimportant");
  });
  it("ai: marks the sender important", async () => {
    const { store, deps } = make();
    await handleCallback("ai:b2", deps);
    expect(store.findRuleFor("ceo@acme.com","acme.com")?.verdict).toBe("important");
  });
  it("rejects unknown actions", async () => {
    const { deps } = make();
    expect((await handleCallback("zz:1", deps)).reply).toMatch(/unknown/i);
  });
});
