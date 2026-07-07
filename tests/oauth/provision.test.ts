import { describe, it, expect } from "vitest";
import { parseProvisionBody, provisionUser } from "../../src/oauth/provision.js";
import { fakeTelegramLinkRepo } from "../../src/users/identity.js";
import { fakeSettingsRepo } from "../../src/settings/settings.js";
import { fakeOAuthStateRepo } from "../../src/oauth/reconnect.js";

describe("parseProvisionBody", () => {
  it("accepts a valid telegramUserId + language", () => {
    expect(parseProvisionBody({ telegramUserId: 42, language: "he" })).toEqual({ telegramUserId: 42, language: "he" });
    expect(parseProvisionBody({ telegramUserId: 42, language: "en" })).toEqual({ telegramUserId: 42, language: "en" });
  });
  it("rejects a bad telegramUserId", () => {
    expect(parseProvisionBody({ telegramUserId: "x", language: "he" })).toHaveProperty("error");
    expect(parseProvisionBody({ telegramUserId: 1.5, language: "he" })).toHaveProperty("error");
    expect(parseProvisionBody({ language: "he" })).toHaveProperty("error");
  });
  it("rejects a bad language", () => {
    expect(parseProvisionBody({ telegramUserId: 42, language: "fr" })).toHaveProperty("error");
    expect(parseProvisionBody({ telegramUserId: 42 })).toHaveProperty("error");
  });
  it("rejects non-objects", () => {
    expect(parseProvisionBody(null)).toHaveProperty("error");
    expect(parseProvisionBody([])).toHaveProperty("error");
  });
});

describe("provisionUser", () => {
  it("creates a fresh user, links telegram, sets language, returns a consent url bound to a fresh state", async () => {
    const links = fakeTelegramLinkRepo();
    const settings = fakeSettingsRepo();
    const states = fakeOAuthStateRepo();
    let nextId = 5;
    const now = new Date("2026-07-07T10:00:00Z");
    const res = await provisionUser({
      createUser: async () => nextId++,
      links, settings, states,
      buildConsentUrl: (s) => `https://consent?state=${s}`,
      genState: () => "STATE1",
      ttlMs: 3_600_000,
    }, { telegramUserId: 999, language: "he" }, now);

    expect(res).toEqual({ userId: 5, consentUrl: "https://consent?state=STATE1" });
    expect(links.all()).toEqual([{ userId: 5, telegramUserId: 999, chatId: 999 }]);
    expect((await settings.get(5))?.language).toBe("he");
    // state is fresh within the 1h window...
    expect(await states.consume("STATE1", new Date(now.getTime() + 3_599_000))).toBe(5);
  });

  it("expires the consent state after its ttl", async () => {
    const states = fakeOAuthStateRepo();
    const now = new Date("2026-07-07T10:00:00Z");
    await provisionUser({
      createUser: async () => 5, links: fakeTelegramLinkRepo(), settings: fakeSettingsRepo(), states,
      buildConsentUrl: (s) => s, genState: () => "S", ttlMs: 3_600_000,
    }, { telegramUserId: 1, language: "en" }, now);
    expect(await states.consume("S", new Date(now.getTime() + 3_600_001))).toBeNull();
  });

  it("rejects a telegram id that is already linked (creates nothing)", async () => {
    const links = fakeTelegramLinkRepo([{ userId: 1, telegramUserId: 999, chatId: 999 }]);
    const res = await provisionUser({
      createUser: async () => { throw new Error("should not create a user"); },
      links, settings: fakeSettingsRepo(), states: fakeOAuthStateRepo(),
      buildConsentUrl: () => "x", genState: () => "s", ttlMs: 1000,
    }, { telegramUserId: 999, language: "en" }, new Date());
    expect(res).toHaveProperty("error");
    expect(links.all()).toHaveLength(1); // untouched
  });
});
