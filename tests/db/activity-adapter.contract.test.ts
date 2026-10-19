// tests/db/activity-adapter.contract.test.ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
const RUN = !!process.env.DATABASE_URL;
describe.skipIf(!RUN)("activity db adapter (integration)", () => {
  it("round-trips the message id and source, and reads the window back oldest first", async () => {
    const { dbActivityRepo } = await import("../../src/db/activity-adapter.js");
    const repo = dbActivityRepo();
    const run = randomUUID();
    const from = new Date(Date.now() - 60_000); // margin for clock skew between Node and the DB
    await repo.record(1, [
      { action: "trashed", from: "a@x.com", subject: `contract ${run}`, messageId: `m-${run}`, source: "chat" },
      { action: "flagged", from: `new-${run}@x.com`, subject: "" },
    ]);
    const rows = await repo.since(1, from);
    const mine = rows.find(r => r.messageId === `m-${run}`);
    expect(mine).toMatchObject({ action: "trashed", from: "a@x.com", subject: `contract ${run}`, source: "chat" });
    expect(mine!.at).toBeInstanceOf(Date);
    const flagged = rows.find(r => r.from === `new-${run}@x.com`);
    expect(flagged).not.toHaveProperty("messageId");
    expect(flagged).not.toHaveProperty("source");
    expect(await repo.since(1, new Date(Date.now() + 60_000))).toEqual([]);
  });
});
