// tests/db/cleanup-adapters.contract.test.ts
import { describe, it, expect } from "vitest";
const RUN = !!process.env.DATABASE_URL;
describe.skipIf(!RUN)("cleanup db adapters (integration)", () => {
  it("proposal create/get/confirm round-trips", async () => {
    const { dbProposalRepo } = await import("../../src/db/cleanup-adapters.js");
    const repo = dbProposalRepo();
    const p = await repo.create(1, ["a", "b"], "test");
    expect((await repo.get(1, p.id))?.messageIds).toEqual(["a", "b"]);
    await repo.markConfirmed(1, p.id);
    expect((await repo.get(1, p.id))?.status).toBe("confirmed");
  });
});
