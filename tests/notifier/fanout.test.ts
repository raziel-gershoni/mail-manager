import { describe, it, expect, vi } from "vitest";
import { pollAllUsers, POLL_LOOP_BUDGET_MS } from "../../src/notifier/fanout.js";
import { localWeekdayHour } from "../../src/settings/window.js";
import { ALWAYS_ON, type DayHours } from "../../src/settings/schedule.js";
import { fakeTelegramLinkRepo, fakeUserDirectory } from "../../src/users/identity.js";
import type { EffectiveSettings } from "../../src/settings/settings.js";

const OWNER = 555;
const IN_WINDOW = new Date("2026-07-02T12:00:00Z"); // noon UTC
const every = (hours: DayHours | null) => Array.from({ length: 7 }, () => hours);
const on = (over: Partial<EffectiveSettings> = {}): EffectiveSettings =>
  ({ timezone: "UTC", paused: false, language: "en", schedule: every({ from: 8, to: 22 }), ...over });

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
    // 08–09 UTC every day; now is noon UTC → outside
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: dir, now: IN_WINDOW,
      settingsFor: async () => on({ schedule: every({ from: 8, to: 9 }) }), pollUser: async (u) => { calls.push(u); } });
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

  it("gates a user on a day that's off, polls them on a day that's on", async () => {
    const today = localWeekdayHour(IN_WINDOW, "UTC").weekday;
    const links = fakeTelegramLinkRepo([{ userId: 1, telegramUserId: OWNER, chatId: OWNER }]);
    const dir = fakeUserDirectory([1]);
    const calls: number[] = [];
    const off = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: dir, now: IN_WINDOW,
      settingsFor: async () => on({ schedule: ALWAYS_ON.map((h, d) => (d === today ? null : h)) }), pollUser: async (u) => { calls.push(u); } });
    expect(calls).toEqual([]);
    expect(off).toEqual({ polled: 0, skipped: 0, gated: 1, errored: 0 });
    const onDay = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: dir, now: IN_WINDOW,
      settingsFor: async () => on({ schedule: ALWAYS_ON.map((h, d) => (d === today ? h : null)) }), pollUser: async (u) => { calls.push(u); } });
    expect(calls).toEqual([1]);
    expect(onDay).toEqual({ polled: 1, skipped: 0, gated: 0, errored: 0 });
  });

  it("logs why a user was gated: paused, or outside their schedule", async () => {
    const links = fakeTelegramLinkRepo([
      { userId: 1, telegramUserId: OWNER, chatId: OWNER },
      { userId: 2, telegramUserId: 222, chatId: 222 },
      { userId: 3, telegramUserId: 333, chatId: 333 },
    ]);
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: fakeUserDirectory([1, 2, 3]), now: IN_WINDOW,
        settingsFor: async (u) => (u === 1 ? on({ paused: true }) : u === 2 ? on({ schedule: every({ from: 8, to: 9 }) }) : on()),
        pollUser: async () => {} });
      expect(res).toEqual({ polled: 1, skipped: 0, gated: 2, errored: 0 });
      const events = out.mock.calls.flatMap(c => { try { return [JSON.parse(String(c[0]))]; } catch { return []; } });
      const gated = events.filter(e => e.event === "poll.gated");
      expect(gated).toHaveLength(2);
      expect(gated).toEqual(expect.arrayContaining([
        { event: "poll.gated", userId: 1, reason: "paused" },
        { event: "poll.gated", userId: 2, reason: "schedule" },
      ]));
    } finally {
      out.mockRestore();
    }
  });

  it("hands each poll a deadline POLL_LOOP_BUDGET_MS after the run started", async () => {
    const links = fakeTelegramLinkRepo([{ userId: 1, telegramUserId: OWNER, chatId: OWNER }]);
    const deadlines: number[] = [];
    await pollAllUsers({ ownerTelegramId: OWNER, links, directory: fakeUserDirectory([1]), now: IN_WINDOW,
      settingsFor: async () => on(), pollUser: async (_u, _c, _tz, _l, deadline) => { deadlines.push(deadline); } });
    expect(POLL_LOOP_BUDGET_MS).toBe(200_000);
    expect(deadlines).toEqual([IN_WINDOW.getTime() + 200_000]);
  });

  it("polls users concurrently, so one user's long catch-up can't hold up another", async () => {
    // User 1's poll can only finish once user 2's poll has started. Run one after the
    // other, this deadlocks and the test times out.
    const links = fakeTelegramLinkRepo([
      { userId: 1, telegramUserId: OWNER, chatId: OWNER },
      { userId: 2, telegramUserId: 222, chatId: 222 },
    ]);
    let release!: () => void;
    const user2Started = new Promise<void>(r => { release = r; });
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: fakeUserDirectory([1, 2]), now: IN_WINDOW,
      settingsFor: async () => on(), pollUser: async (u) => { if (u === 1) await user2Started; else release(); } });
    expect(res).toEqual({ polled: 2, skipped: 0, gated: 0, errored: 0 });
  }, 2_000);

  it("isolates a failing settings lookup: the other user is still polled, the failure counted", async () => {
    const links = fakeTelegramLinkRepo([
      { userId: 1, telegramUserId: OWNER, chatId: OWNER },
      { userId: 2, telegramUserId: 222, chatId: 222 },
    ]);
    const ok: number[] = [];
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: fakeUserDirectory([1, 2]), now: IN_WINDOW,
      settingsFor: async (u) => { if (u === 1) throw new Error("db down"); return on(); },
      pollUser: async (u) => { ok.push(u); } });
    expect(ok).toEqual([2]);
    expect(res).toEqual({ polled: 1, skipped: 0, gated: 0, errored: 1 });
  });

  // The poll_errored ops event (weekly retrospect) is recorded through this hook.
  it("reports a failed user poll to onUserError with the user and the error, still counting it errored", async () => {
    const links = fakeTelegramLinkRepo([
      { userId: 1, telegramUserId: OWNER, chatId: OWNER },
      { userId: 2, telegramUserId: 222, chatId: 222 },
    ]);
    const reported: Array<{ userId: number; message: string }> = [];
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: fakeUserDirectory([1, 2]), now: IN_WINDOW,
      settingsFor: async () => on(),
      pollUser: async (u) => { if (u === 1) throw new Error("boom"); },
      onUserError: async (userId, err) => { reported.push({ userId, message: err instanceof Error ? err.message : String(err) }); } });
    expect(reported).toEqual([{ userId: 1, message: "boom" }]);
    expect(res).toEqual({ polled: 1, skipped: 0, gated: 0, errored: 1 });
  });

  it("a failing onUserError hook changes nothing: the user is still errored and the others still polled", async () => {
    const links = fakeTelegramLinkRepo([
      { userId: 1, telegramUserId: OWNER, chatId: OWNER },
      { userId: 2, telegramUserId: 222, chatId: 222 },
    ]);
    const ok: number[] = [];
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: fakeUserDirectory([1, 2]), now: IN_WINDOW,
      settingsFor: async () => on(),
      pollUser: async (u) => { if (u === 1) throw new Error("boom"); ok.push(u); },
      onUserError: async () => { throw new Error("ops db down"); } });
    expect(ok).toEqual([2]);
    expect(res).toEqual({ polled: 1, skipped: 0, gated: 0, errored: 1 });
  });

  it("does not call onUserError for users that were polled, gated or skipped", async () => {
    const links = fakeTelegramLinkRepo([
      { userId: 1, telegramUserId: OWNER, chatId: OWNER },
      { userId: 2, telegramUserId: 222, chatId: 222 },
    ]);
    const reported: number[] = [];
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: fakeUserDirectory([1, 2, 3]), now: IN_WINDOW,
      settingsFor: async (u) => on({ paused: u === 2 }),
      pollUser: async () => {},
      onUserError: async (userId) => { reported.push(userId); } });
    expect(res).toEqual({ polled: 1, skipped: 1, gated: 1, errored: 0 });
    expect(reported).toEqual([]);
  });
});
