// tests/db/ops-events-adapter.contract.test.ts
import { describe, it, expect } from "vitest";
const RUN = !!process.env.DATABASE_URL;
describe.skipIf(!RUN)("ops events db adapter (integration)", () => {
  it("records, reads back since a date (detail jsonb or null), and prunes before a date", async () => {
    const { dbOpsEventRepo } = await import("../../src/db/ops-events-adapter.js");
    const repo = dbOpsEventRepo();
    const from = new Date(Date.now() - 60_000); // margin for clock skew between Node and the DB
    await repo.record(1, "poll_incomplete", { processed: 3, remaining: 7 });
    await repo.record(1, "cursor_expired");
    const got = await repo.since(1, from);
    expect(got.find(e => e.kind === "poll_incomplete")?.detail).toEqual({ processed: 3, remaining: 7 });
    expect(got.find(e => e.kind === "cursor_expired")?.detail).toBeNull();
    expect(got.every(e => e.at instanceof Date)).toBe(true);
    await repo.prune(new Date(Date.now() + 60_000));
    expect(await repo.since(1, from)).toEqual([]);
  });
});
