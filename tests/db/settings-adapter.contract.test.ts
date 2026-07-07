import { describe, it, expect } from "vitest";
const RUN = !!process.env.DATABASE_URL;
describe.skipIf(!RUN)("settings-adapter (DB contract)", () => {
  it("upserts and round-trips settings for a user", async () => {
    const { dbSettingsRepo } = await import("../../src/db/settings-adapter.js");
    const repo = dbSettingsRepo();
    await repo.upsert(1, { timezone: "Asia/Jerusalem", digestStartHour: 9, digestEndHour: 21, paused: true, language: "en" });
    await repo.upsert(1, { timezone: "Asia/Jerusalem", digestStartHour: 9, digestEndHour: 21, paused: false, language: "he" }); // update
    expect(await repo.get(1)).toEqual({ timezone: "Asia/Jerusalem", digestStartHour: 9, digestEndHour: 21, paused: false, language: "he" });
  });
});
