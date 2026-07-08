import { describe, it, expect } from "vitest";
import { buildDigestRefs, fakeDigestRefRepo } from "../../src/notifier/refs.js";

describe("buildDigestRefs", () => {
  it("couples surfaced + acted messages to their Gmail ids", () => {
    const refs = buildDigestRefs(
      [{ messageId: "imp1", from: "boss@work.com", subject: "urgent" }],
      [{ id: "j1", from: "promo@shop.com", subject: "50% off", action: "trashed" }],
    );
    expect(refs).toEqual([
      { id: "imp1", from: "boss@work.com", subject: "urgent", kind: "surfaced" },
      { id: "j1", from: "promo@shop.com", subject: "50% off", kind: "trashed" },
    ]);
  });
  it("is empty when the digest referenced nothing concrete", () => {
    expect(buildDigestRefs([], [])).toEqual([]);
  });
  it("orders refs to match the digest layout: surfaced, then trashed, then archived", () => {
    const refs = buildDigestRefs(
      [{ messageId: "imp1", from: "boss@work.com", subject: "urgent" }],
      // processing order interleaves archive before trash — the refs must regroup
      [{ id: "a1", from: "news@list.com", subject: "weekly", action: "archived" },
       { id: "t1", from: "promo@shop.com", subject: "50% off", action: "trashed" },
       { id: "a2", from: "digest@list.com", subject: "daily", action: "archived" }],
    );
    expect(refs.map(r => `${r.kind}:${r.id}`)).toEqual([
      "surfaced:imp1", "trashed:t1", "archived:a1", "archived:a2",
    ]);
  });
});

describe("fakeDigestRefRepo", () => {
  it("saves and looks up refs by (userId, telegramMessageId), scoped per user", async () => {
    const repo = fakeDigestRefRepo();
    const refs = [{ id: "j1", from: "a@x.com", subject: "s", kind: "trashed" }];
    await repo.save(1, 555, refs);
    expect(await repo.lookup(1, 555)).toEqual(refs);
    expect(await repo.lookup(1, 999)).toBeNull();  // unknown message id
    expect(await repo.lookup(2, 555)).toBeNull();  // different user
  });
});
