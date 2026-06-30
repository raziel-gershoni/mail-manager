import { describe, it, expect } from "vitest";
const RUN = !!process.env.DATABASE_URL;
describe.skipIf(!RUN)("db adapters (integration)", () => {
  it("sync repo round-trips a cursor", async () => {
    const { dbSyncRepo } = await import("../../src/db/adapters.js");
    const repo = dbSyncRepo();
    await repo.set(1, "12345");
    expect(await repo.get(1)).toBe("12345");
  });
});
