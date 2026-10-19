// tests/db/weekly-runs-adapter.contract.test.ts
import { describe, it, expect } from "vitest";
const RUN = !!process.env.DATABASE_URL;
describe.skipIf(!RUN)("weekly runs db adapter (integration)", () => {
  it("upserts the week key per (user, kind) and reads it back", async () => {
    const { dbWeeklyRunRepo } = await import("../../src/db/weekly-runs-adapter.js");
    const repo = dbWeeklyRunRepo();
    const original = await repo.get(1, "retro");
    try {
      await repo.set(1, "retro", "2000-01-02");
      expect(await repo.get(1, "retro")).toBe("2000-01-02");
      await repo.set(1, "retro", "2000-01-09"); // second write for the same (user, kind) updates, not duplicates
      expect(await repo.get(1, "retro")).toBe("2000-01-09");
    } finally {
      // Put the real key back so the dev user's next retrospect isn't re-triggered by this test.
      if (original !== null) await repo.set(1, "retro", original);
    }
  });
});
