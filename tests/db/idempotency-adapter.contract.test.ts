import { describe, it, expect } from "vitest";
const RUN = !!process.env.DATABASE_URL;
describe.skipIf(!RUN)("idempotency db adapter (contract)", () => {
  it("claim is one-time per update id; release allows reclaiming", async () => {
    const { dbIdempotencyRepo } = await import("../../src/db/idempotency-adapter.js");
    const repo = dbIdempotencyRepo();
    const id = `upd_${Math.floor(Date.now() % 1e9)}`;
    expect(await repo.claim(id)).toBe(true);
    expect(await repo.claim(id)).toBe(false);
    await repo.release(id);
    expect(await repo.claim(id)).toBe(true);
    await repo.release(id);
  });
});
