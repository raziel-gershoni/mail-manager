import { describe, it, expect, vi } from "vitest";
import { localWeekdayHour, isScheduledNow } from "../../src/settings/window.js";
import { ALWAYS_ON, type WeekSchedule } from "../../src/settings/schedule.js";

describe("localWeekdayHour", () => {
  it("reads the local weekday and hour (summer, UTC+3)", () => {
    const t = new Date("2026-07-03T21:30:00Z"); // Fri 21:30 UTC = Sat 00:30 in Jerusalem
    expect(localWeekdayHour(t, "UTC")).toEqual({ weekday: 5, hour: 21 });
    expect(localWeekdayHour(t, "Asia/Jerusalem")).toEqual({ weekday: 6, hour: 0 });
  });
  it("reads it in winter too (UTC+2)", () => {
    expect(localWeekdayHour(new Date("2026-12-04T22:30:00Z"), "Asia/Jerusalem")).toEqual({ weekday: 6, hour: 0 });
  });
  it("follows the clock across the end of DST (Jerusalem, 2026-10-25)", () => {
    expect(localWeekdayHour(new Date("2026-10-24T20:30:00Z"), "Asia/Jerusalem")).toEqual({ weekday: 6, hour: 23 }); // Sat 23:30 IDT
    expect(localWeekdayHour(new Date("2026-10-24T22:30:00Z"), "Asia/Jerusalem")).toEqual({ weekday: 0, hour: 1 });  // Sun 01:30 IDT
    expect(localWeekdayHour(new Date("2026-10-24T23:30:00Z"), "Asia/Jerusalem")).toEqual({ weekday: 0, hour: 1 });  // Sun 01:30 IST, the repeated hour
    expect(localWeekdayHour(new Date("2026-10-25T00:30:00Z"), "Asia/Jerusalem")).toEqual({ weekday: 0, hour: 2 });
    expect(localWeekdayHour(new Date("2026-10-25T22:30:00Z"), "Asia/Jerusalem")).toEqual({ weekday: 1, hour: 0 });  // Mon 00:30 IST
  });
  it("falls back to UTC on an invalid or empty timezone", () => {
    const t = new Date("2026-07-03T21:30:00Z");
    expect(localWeekdayHour(t, "Not/AZone")).toEqual({ weekday: 5, hour: 21 });
    expect(localWeekdayHour(t, "")).toEqual({ weekday: 5, hour: 21 });
  });
  it("reads midnight as hour 0, even where ICU renders it as 24", () => {
    expect(localWeekdayHour(new Date("2026-07-02T00:30:00Z"), "UTC")).toEqual({ weekday: 4, hour: 0 });
    // A function, not an arrow: the code under test calls it with `new`.
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function () {
      return { formatToParts: () => [{ type: "weekday", value: "Fri" }, { type: "literal", value: ", " }, { type: "hour", value: "24" }] };
    } as unknown as typeof Intl.DateTimeFormat);
    try {
      expect(localWeekdayHour(new Date("2026-07-03T00:00:00Z"), "UTC")).toEqual({ weekday: 5, hour: 0 });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("isScheduledNow", () => {
  const h = (from: number, to: number) => ({ from, to });
  const OWNER: WeekSchedule = [h(7, 23), h(7, 23), h(7, 23), h(7, 23), h(7, 23), h(7, 15), h(23, 24)];
  it("checks the user's own local day and hour", () => {
    // Sat 2026-10-24 23:30 in Jerusalem (20:30 UTC): the one Saturday check
    expect(isScheduledNow(new Date("2026-10-24T20:30:00Z"), "Asia/Jerusalem", OWNER)).toBe(true);
    // The same instant is Sat 20:30 in UTC: outside
    expect(isScheduledNow(new Date("2026-10-24T20:30:00Z"), "UTC", OWNER)).toBe(false);
    // Sun 01:30 local: before Sunday's 07:00, and Saturday's hour doesn't run past midnight
    expect(isScheduledNow(new Date("2026-10-24T22:30:00Z"), "Asia/Jerusalem", OWNER)).toBe(false);
    // Fri 14:30 local is the last Friday check; 15:30 is out
    expect(isScheduledNow(new Date("2026-10-23T11:30:00Z"), "Asia/Jerusalem", OWNER)).toBe(true);
    expect(isScheduledNow(new Date("2026-10-23T12:30:00Z"), "Asia/Jerusalem", OWNER)).toBe(false);
  });
  it("the default schedule is always on", () => {
    expect(isScheduledNow(new Date("2026-10-24T21:00:00Z"), "Asia/Jerusalem", ALWAYS_ON)).toBe(true);
  });
});
