import { describe, it, expect } from "vitest";
import { pollAllUsers } from "../../src/notifier/fanout.js";
import { fakeTelegramLinkRepo, fakeUserDirectory } from "../../src/users/identity.js";

const OWNER = 555;

describe("pollAllUsers", () => {
  it("ensures the owner link, then polls each user at their chatId", async () => {
    const links = fakeTelegramLinkRepo([]);         // owner link will be bootstrapped
    const dir = fakeUserDirectory([1]);
    const calls: Array<{ userId: number; chatId: number }> = [];
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: dir,
      pollUser: async (userId, chatId) => { calls.push({ userId, chatId }); } });
    expect(calls).toEqual([{ userId: 1, chatId: OWNER }]);
    expect(res).toEqual({ polled: 1, skipped: 0, errored: 0 });
  });
  it("skips a user with no telegram link", async () => {
    const links = fakeTelegramLinkRepo([{ userId: 1, telegramUserId: OWNER, chatId: OWNER }]);
    const dir = fakeUserDirectory([1, 2]);          // user 2 has a google account but no link
    const calls: number[] = [];
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: dir,
      pollUser: async (userId) => { calls.push(userId); } });
    expect(calls).toEqual([1]);
    expect(res).toEqual({ polled: 1, skipped: 1, errored: 0 });
  });
  it("isolates a per-user failure and continues", async () => {
    const links = fakeTelegramLinkRepo([
      { userId: 1, telegramUserId: OWNER, chatId: OWNER },
      { userId: 2, telegramUserId: 222, chatId: 222 },
    ]);
    const dir = fakeUserDirectory([1, 2]);
    const ok: number[] = [];
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: dir,
      pollUser: async (userId) => { if (userId === 1) throw new Error("boom"); ok.push(userId); } });
    expect(ok).toEqual([2]);
    expect(res).toEqual({ polled: 1, skipped: 0, errored: 1 });
  });
});
