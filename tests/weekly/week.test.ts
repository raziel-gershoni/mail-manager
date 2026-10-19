// tests/weekly/week.test.ts
import { describe, it, expect } from "vitest";
import { weekKey } from "../../src/weekly/week.js";

describe("weekKey", () => {
  it("is the Sunday that starts the week (Sunday–Saturday), as YYYY-MM-DD", () => {
    expect(weekKey(new Date("2026-10-18T09:00:00Z"), "UTC")).toBe("2026-10-18"); // Sunday itself
    expect(weekKey(new Date("2026-10-21T12:00:00Z"), "UTC")).toBe("2026-10-18"); // Wednesday
    expect(weekKey(new Date("2026-10-24T12:00:00Z"), "UTC")).toBe("2026-10-18"); // Saturday
  });

  it("turns over at midnight from Saturday to Sunday", () => {
    expect(weekKey(new Date("2026-10-24T23:59:59Z"), "UTC")).toBe("2026-10-18"); // Sat 23:59:59
    expect(weekKey(new Date("2026-10-25T00:00:00Z"), "UTC")).toBe("2026-10-25"); // Sun 00:00
  });

  it("uses the user's LOCAL date, not UTC's, across a timezone boundary", () => {
    // Sat 2026-10-17 21:30 UTC is already Sun 00:30 in Jerusalem (UTC+3 in October)...
    const t = new Date("2026-10-17T21:30:00Z");
    expect(weekKey(t, "Asia/Jerusalem")).toBe("2026-10-18");
    expect(weekKey(t, "UTC")).toBe("2026-10-11");
    // ...and Sun 2026-10-18 05:00 UTC is still Sat 22:00 in Los Angeles.
    const u = new Date("2026-10-18T05:00:00Z");
    expect(weekKey(u, "America/Los_Angeles")).toBe("2026-10-11");
    expect(weekKey(u, "UTC")).toBe("2026-10-18");
  });

  it("turns over at LOCAL midnight in the user's zone, including the night DST ends", () => {
    expect(weekKey(new Date("2026-10-24T20:59:00Z"), "Asia/Jerusalem")).toBe("2026-10-18"); // Sat 23:59 IDT
    expect(weekKey(new Date("2026-10-24T22:30:00Z"), "Asia/Jerusalem")).toBe("2026-10-25"); // Sun 01:30, the DST-end night
  });

  it("crosses month and year boundaries", () => {
    expect(weekKey(new Date("2026-12-31T12:00:00Z"), "UTC")).toBe("2026-12-27"); // Thursday
    expect(weekKey(new Date("2027-01-02T12:00:00Z"), "UTC")).toBe("2026-12-27"); // Saturday, next year
    expect(weekKey(new Date("2027-01-03T00:00:00Z"), "UTC")).toBe("2027-01-03"); // Sunday
  });

  it("falls back to UTC on an invalid timezone", () => {
    expect(weekKey(new Date("2026-10-17T21:30:00Z"), "Not/AZone")).toBe("2026-10-11");
    expect(weekKey(new Date("2026-10-17T21:30:00Z"), "")).toBe("2026-10-11");
  });
});
