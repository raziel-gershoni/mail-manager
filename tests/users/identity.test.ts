import { describe, it, expect } from "vitest";
import {
  fakeTelegramLinkRepo, fakeUserDirectory,
  resolveUserForTelegram, isAuthorizedTelegram, ensureOwnerLink,
} from "../../src/users/identity.js";

const OWNER = 555;

describe("resolveUserForTelegram", () => {
  it("returns the linked userId for an existing link (no owner fallback)", async () => {
    const links = fakeTelegramLinkRepo([{ userId: 7, telegramUserId: 999, chatId: 999 }]);
    const dir = fakeUserDirectory([7]);
    expect(await resolveUserForTelegram(OWNER, 999, 999, links, dir)).toBe(7);
  });
  it("bootstraps the owner: resolves to the owner user and upserts a link with the real chatId", async () => {
    const links = fakeTelegramLinkRepo([]);
    const dir = fakeUserDirectory([3]); // owner user = min id with a google account
    expect(await resolveUserForTelegram(OWNER, OWNER, OWNER, links, dir)).toBe(3);
    expect(links.all()).toEqual([{ userId: 3, telegramUserId: OWNER, chatId: OWNER }]);
  });
  it("returns null for an unlinked non-owner id (not authorized)", async () => {
    const links = fakeTelegramLinkRepo([]);
    const dir = fakeUserDirectory([3]);
    expect(await resolveUserForTelegram(OWNER, 123, 123, links, dir)).toBeNull();
    expect(links.all()).toEqual([]);
  });
  it("returns null when the owner messages but no user is bootstrapped yet", async () => {
    const links = fakeTelegramLinkRepo([]);
    const dir = fakeUserDirectory([]); // no google account exists
    expect(await resolveUserForTelegram(OWNER, OWNER, OWNER, links, dir)).toBeNull();
  });
});

describe("isAuthorizedTelegram", () => {
  it("authorizes the owner id without a DB read", async () => {
    const links = fakeTelegramLinkRepo([]);
    expect(await isAuthorizedTelegram(OWNER, OWNER, links)).toBe(true);
  });
  it("authorizes a linked non-owner id", async () => {
    const links = fakeTelegramLinkRepo([{ userId: 7, telegramUserId: 999, chatId: 999 }]);
    expect(await isAuthorizedTelegram(OWNER, 999, links)).toBe(true);
  });
  it("rejects an unlinked non-owner id", async () => {
    const links = fakeTelegramLinkRepo([]);
    expect(await isAuthorizedTelegram(OWNER, 123, links)).toBe(false);
  });
});

describe("ensureOwnerLink", () => {
  it("creates the owner link (chatId = ownerTelegramId) when missing", async () => {
    const links = fakeTelegramLinkRepo([]);
    const dir = fakeUserDirectory([4]);
    await ensureOwnerLink(OWNER, links, dir);
    expect(links.all()).toEqual([{ userId: 4, telegramUserId: OWNER, chatId: OWNER }]);
  });
  it("is a no-op when the owner link already exists", async () => {
    const links = fakeTelegramLinkRepo([{ userId: 4, telegramUserId: OWNER, chatId: OWNER }]);
    const dir = fakeUserDirectory([4]);
    await ensureOwnerLink(OWNER, links, dir);
    expect(links.all().length).toBe(1);
  });
  it("is a no-op when no user is bootstrapped", async () => {
    const links = fakeTelegramLinkRepo([]);
    const dir = fakeUserDirectory([]);
    await ensureOwnerLink(OWNER, links, dir);
    expect(links.all()).toEqual([]);
  });
});
