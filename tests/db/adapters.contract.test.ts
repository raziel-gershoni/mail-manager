import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
const RUN = !!process.env.DATABASE_URL;
describe.skipIf(!RUN)("db adapters (integration)", () => {
  it("sync repo round-trips a cursor", async () => {
    const { dbSyncRepo } = await import("../../src/db/adapters.js");
    const repo = dbSyncRepo();
    await repo.set(1, "12345");
    expect(await repo.get(1)).toBe("12345");
  });

  it("seen repo hasMany returns exactly the recorded ids, across lookup chunks", async () => {
    const { dbSeenRepo } = await import("../../src/db/adapters.js");
    const repo = dbSeenRepo();
    const run = randomUUID();
    const ids = Array.from({ length: 1001 }, (_, i) => `${run}-${i}`); // spans three 500-id chunks
    await repo.record(1, { messageId: ids[3]!, surfaced: false, verdict: "unimportant", reason: "contract" });
    await repo.record(1, { messageId: ids[1000]!, surfaced: true, verdict: "important", reason: "contract" });
    expect([...await repo.hasMany(1, ids)].sort()).toEqual([ids[1000]!, ids[3]!].sort());
    expect((await repo.hasMany(1, [])).size).toBe(0);
  });
});
