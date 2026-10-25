import { describe, it, expect, vi } from "vitest";
import { readStoredSchedule } from "../../src/db/settings-adapter.js";
import { ALWAYS_ON, type WeekSchedule } from "../../src/settings/schedule.js";

describe("readStoredSchedule", () => {
  it("passes a valid stored schedule through", () => {
    const week: WeekSchedule = [{ from: 7, to: 23 }, null, null, null, null, null, { from: 23, to: 24 }];
    expect(readStoredSchedule(week, 7)).toBe(week);
  });
  it("reads a bad stored value as every day all day, and logs it", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(readStoredSchedule([{ from: 9 }], 7)).toBe(ALWAYS_ON);
      expect(readStoredSchedule(null, 7)).toBe(ALWAYS_ON);
      const events = out.mock.calls.map(c => JSON.parse(String(c[0])));
      expect(events).toEqual([
        expect.objectContaining({ event: "settings.bad_schedule", userId: 7 }),
        expect.objectContaining({ event: "settings.bad_schedule", userId: 7 }),
      ]);
    } finally {
      out.mockRestore();
    }
  });
});
