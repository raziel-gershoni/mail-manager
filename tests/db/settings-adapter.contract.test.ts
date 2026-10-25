import { describe, it, expect } from "vitest";
const RUN = !!process.env.DATABASE_URL;
describe.skipIf(!RUN)("settings-adapter (DB contract)", () => {
  it("upserts and round-trips settings for a user, off days included", async () => {
    const { dbSettingsRepo } = await import("../../src/db/settings-adapter.js");
    const { ALWAYS_ON } = await import("../../src/settings/schedule.js");
    const week = [{ from: 7, to: 23 }, { from: 7, to: 23 }, { from: 7, to: 23 }, { from: 7, to: 23 }, { from: 7, to: 23 }, { from: 7, to: 15 }, null];
    const repo = dbSettingsRepo();
    await repo.upsert(1, { timezone: "Asia/Jerusalem", paused: true, language: "en", schedule: ALWAYS_ON });
    await repo.upsert(1, { timezone: "Asia/Jerusalem", paused: false, language: "he", schedule: week }); // update
    expect(await repo.get(1)).toEqual({ timezone: "Asia/Jerusalem", paused: false, language: "he", schedule: week });
  });
});
