import { describe, it, expect, vi } from "vitest";
import { hourInZone, isWithinDigestWindow, weekdayInZone, isActiveDay, localWeekdayHour, isScheduledNow } from "../../src/settings/window.js";
import { ALWAYS_ON, type WeekSchedule } from "../../src/settings/schedule.js";

describe("hourInZone", () => {
  it("reads the wall-clock hour in a timezone", () => {
    const noonUtc = new Date("2026-07-02T12:00:00Z");
    expect(hourInZone(noonUtc, "UTC")).toBe(12);
    // Asia/Jerusalem is UTC+3 in July (DST) → 15:00
    expect(hourInZone(noonUtc, "Asia/Jerusalem")).toBe(15);
  });
  it("falls back to UTC on an invalid timezone", () => {
    const noonUtc = new Date("2026-07-02T12:00:00Z");
    expect(hourInZone(noonUtc, "Not/AZone")).toBe(12);
  });
  it("normalizes midnight to 0 (never 24)", () => {
    const midnightUtc = new Date("2026-07-02T00:30:00Z");
    expect(hourInZone(midnightUtc, "UTC")).toBe(0);
  });
  it("normalizes a '24' hour string to 0 (defensive against ICU midnight rendering)", () => {
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation((() => ({ format: () => "24" })) as unknown as typeof Intl.DateTimeFormat);
    try {
      expect(hourInZone(new Date("2026-07-02T00:00:00Z"), "UTC")).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("isWithinDigestWindow", () => {
  const at = (h: number) => new Date(`2026-07-02T${String(h).padStart(2, "0")}:00:00Z`);
  it("normal daytime window 8-22", () => {
    expect(isWithinDigestWindow(at(8), "UTC", 8, 22)).toBe(true);
    expect(isWithinDigestWindow(at(21), "UTC", 8, 22)).toBe(true);
    expect(isWithinDigestWindow(at(22), "UTC", 8, 22)).toBe(false); // end exclusive
    expect(isWithinDigestWindow(at(7), "UTC", 8, 22)).toBe(false);
    expect(isWithinDigestWindow(at(3), "UTC", 8, 22)).toBe(false);
  });
  it("overnight wrap window 22-7", () => {
    expect(isWithinDigestWindow(at(23), "UTC", 22, 7)).toBe(true);
    expect(isWithinDigestWindow(at(3), "UTC", 22, 7)).toBe(true);
    expect(isWithinDigestWindow(at(7), "UTC", 22, 7)).toBe(false); // end exclusive
    expect(isWithinDigestWindow(at(12), "UTC", 22, 7)).toBe(false);
    expect(isWithinDigestWindow(at(22), "UTC", 22, 7)).toBe(true); // start-inclusive
  });
  it("start === end means always-on", () => {
    expect(isWithinDigestWindow(at(3), "UTC", 0, 0)).toBe(true);
    expect(isWithinDigestWindow(at(15), "UTC", 9, 9)).toBe(true);
  });
  it("always-on default window 0-24 covers every hour", () => {
    expect(isWithinDigestWindow(at(0), "UTC", 0, 24)).toBe(true);
    expect(isWithinDigestWindow(at(3), "UTC", 0, 24)).toBe(true);
    expect(isWithinDigestWindow(at(23), "UTC", 0, 24)).toBe(true);
  });
});

describe("weekdayInZone", () => {
  it("reads the weekday in the user's zone, not UTC (summer, UTC+3)", () => {
    // Fri 2026-07-03 21:30 UTC = Sat 00:30 in Jerusalem (IDT)
    const t = new Date("2026-07-03T21:30:00Z");
    expect(weekdayInZone(t, "UTC")).toBe(5);            // Friday
    expect(weekdayInZone(t, "Asia/Jerusalem")).toBe(6); // Saturday
  });
  it("reads the weekday in the user's zone in winter too (UTC+2)", () => {
    // Fri 2026-12-04 22:30 UTC = Sat 00:30 in Jerusalem (IST)
    const t = new Date("2026-12-04T22:30:00Z");
    expect(weekdayInZone(t, "UTC")).toBe(5);
    expect(weekdayInZone(t, "Asia/Jerusalem")).toBe(6);
  });
  it("falls back to UTC on an invalid timezone", () => {
    expect(weekdayInZone(new Date("2026-07-03T21:30:00Z"), "Not/AZone")).toBe(5);
  });
});

describe("isActiveDay", () => {
  const friNightUtc = new Date("2026-07-03T21:30:00Z"); // Saturday 00:30 in Jerusalem
  it("is true on every day when all 7 are active", () => {
    expect(isActiveDay(friNightUtc, "Asia/Jerusalem", [0, 1, 2, 3, 4, 5, 6])).toBe(true);
  });
  it("is false on an inactive day, judged by the LOCAL date", () => {
    const noSaturday = [0, 1, 2, 3, 4, 5];
    expect(isActiveDay(friNightUtc, "Asia/Jerusalem", noSaturday)).toBe(false); // already Saturday locally
    expect(isActiveDay(friNightUtc, "UTC", noSaturday)).toBe(true);             // still Friday in UTC
  });
});

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
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation((() => ({
      formatToParts: () => [{ type: "weekday", value: "Fri" }, { type: "literal", value: ", " }, { type: "hour", value: "24" }],
    })) as unknown as typeof Intl.DateTimeFormat);
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
