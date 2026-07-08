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
