import { describe, it, expect } from "vitest";
import { activityItemsFrom, fakeActivityRepo } from "../../src/notifier/activity.js";

describe("activityItemsFrom", () => {
  it("maps acted messages and flagged un-ruled senders into log items", () => {
    const items = activityItemsFrom(
      [{ from: "promo@shop.com", subject: "50% off", action: "trashed" }, { from: "news@list.com", subject: "weekly", action: "archived" }],
      ["Lee <leea@italent.co.il>"],
    );
    expect(items).toEqual([
      { action: "trashed", from: "promo@shop.com", subject: "50% off" },
      { action: "archived", from: "news@list.com", subject: "weekly" },
      { action: "flagged", from: "Lee <leea@italent.co.il>", subject: "" },
    ]);
  });
  it("is empty when nothing was acted or flagged", () => {
    expect(activityItemsFrom([], [])).toEqual([]);
  });
  it("carries each acted message's Gmail id and why (source), for the weekly retrospect", () => {
    expect(activityItemsFrom([{ id: "g1", from: "promo@shop.com", subject: "50% off", action: "trashed", source: "guarded" }], ["new@x.com"])).toEqual([
      { action: "trashed", from: "promo@shop.com", subject: "50% off", messageId: "g1", source: "guarded" },
      { action: "flagged", from: "new@x.com", subject: "" },
    ]);
  });
});

describe("fakeActivityRepo", () => {
  it("records and returns items newest-first, honoring the limit, scoped per user", async () => {
    const repo = fakeActivityRepo();
    await repo.record(1, [{ action: "trashed", from: "a@x.com", subject: "one" }]);
    await repo.record(1, [{ action: "archived", from: "b@x.com", subject: "two" }]);
    await repo.record(2, [{ action: "trashed", from: "c@x.com", subject: "other user" }]);

    const recent = await repo.recent(1, 10);
    expect(recent.map(r => r.subject)).toEqual(["two", "one"]); // newest first
    expect(recent.every(r => r.at instanceof Date)).toBe(true);

    expect((await repo.recent(1, 1)).map(r => r.subject)).toEqual(["two"]); // limit
    expect((await repo.recent(2, 10)).map(r => r.subject)).toEqual(["other user"]); // per-user
  });
});

describe("fakeActivityRepo.since", () => {
  it("returns a user's records at or after the date, oldest first, with id and source", async () => {
    let now = Date.UTC(2026, 9, 25);
    const repo = fakeActivityRepo(() => new Date(now));
    await repo.record(1, [{ action: "trashed", from: "a@x.com", subject: "before", messageId: "m0", source: "plain" }]);
    now += 1000;
    await repo.record(1, [{ action: "archived", from: "b@x.com", subject: "edge", messageId: "m1", source: "pref" }]);
    now += 1000;
    await repo.record(1, [{ action: "trashed", from: "c@x.com", subject: "after", messageId: "m2", source: "chat" }]);
    await repo.record(2, [{ action: "trashed", from: "d@x.com", subject: "other user" }]);
    const got = await repo.since(1, new Date(Date.UTC(2026, 9, 25) + 1000));
    expect(got.map(r => r.subject)).toEqual(["edge", "after"]);
    expect(got[0]).toEqual({ action: "archived", from: "b@x.com", subject: "edge", messageId: "m1", source: "pref", at: new Date(Date.UTC(2026, 9, 25) + 1000) });
  });
});
