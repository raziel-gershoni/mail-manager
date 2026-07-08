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
