import { describe, it, expect } from "vitest";
import { pollAllUsers } from "../../src/notifier/fanout.js";
import { fakeTelegramLinkRepo, fakeUserDirectory } from "../../src/users/identity.js";
import type { EffectiveSettings } from "../../src/settings/settings.js";

const OWNER = 555;
const IN_WINDOW = new Date("2026-07-02T12:00:00Z"); // noon UTC
const on = (over: Partial<EffectiveSettings> = {}): EffectiveSettings =>
  ({ timezone: "UTC", digestStartHour: 8, digestEndHour: 22, paused: false, language: "en", ...over });

describe("pollAllUsers", () => {
  it("bootstraps the owner link, then polls each in-window user at their chat + timezone", async () => {
    const links = fakeTelegramLinkRepo([]);
    const dir = fakeUserDirectory([1]);
    const calls: Array<{ userId: number; chatId: number; tz: string }> = [];
    const res = await pollAllUsers({
      ownerTelegramId: OWNER, links, directory: dir, now: IN_WINDOW,
      settingsFor: async () => on({ timezone: "Asia/Jerusalem" }),
      pollUser: async (userId, chatId, timezone) => { calls.push({ userId, chatId, tz: timezone }); },
    });
    expect(calls).toEqual([{ userId: 1, chatId: OWNER, tz: "Asia/Jerusalem" }]);
    expect(res).toEqual({ polled: 1, skipped: 0, gated: 0, errored: 0 });
  });
  it("skips a user with no telegram link (skipped), not gated", async () => {
    const links = fakeTelegramLinkRepo([{ userId: 1, telegramUserId: OWNER, chatId: OWNER }]);
    const dir = fakeUserDirectory([1, 2]);
    const calls: number[] = [];
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: dir, now: IN_WINDOW,
      settingsFor: async () => on(), pollUser: async (u) => { calls.push(u); } });
    expect(calls).toEqual([1]);
    expect(res).toEqual({ polled: 1, skipped: 1, gated: 0, errored: 0 });
  });
  it("gates a paused user (gated, no pollUser call)", async () => {
    const links = fakeTelegramLinkRepo([{ userId: 1, telegramUserId: OWNER, chatId: OWNER }]);
    const dir = fakeUserDirectory([1]);
    const calls: number[] = [];
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: dir, now: IN_WINDOW,
      settingsFor: async () => on({ paused: true }), pollUser: async (u) => { calls.push(u); } });
    expect(calls).toEqual([]);
    expect(res).toEqual({ polled: 0, skipped: 0, gated: 1, errored: 0 });
  });
  it("gates a user outside their digest window", async () => {
    const links = fakeTelegramLinkRepo([{ userId: 1, telegramUserId: OWNER, chatId: OWNER }]);
    const dir = fakeUserDirectory([1]);
    const calls: number[] = [];
    // window 8-9 UTC; now is noon UTC → outside
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: dir, now: IN_WINDOW,
      settingsFor: async () => on({ digestStartHour: 8, digestEndHour: 9 }), pollUser: async (u) => { calls.push(u); } });
    expect(calls).toEqual([]);
    expect(res).toEqual({ polled: 0, skipped: 0, gated: 1, errored: 0 });
  });
  it("isolates a per-user failure and continues (errored)", async () => {
    const links = fakeTelegramLinkRepo([
      { userId: 1, telegramUserId: OWNER, chatId: OWNER },
      { userId: 2, telegramUserId: 222, chatId: 222 },
    ]);
    const dir = fakeUserDirectory([1, 2]);
    const ok: number[] = [];
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: dir, now: IN_WINDOW,
      settingsFor: async () => on(), pollUser: async (u) => { if (u === 1) throw new Error("boom"); ok.push(u); } });
    expect(ok).toEqual([2]);
    expect(res).toEqual({ polled: 1, skipped: 0, gated: 0, errored: 1 });
  });
});
