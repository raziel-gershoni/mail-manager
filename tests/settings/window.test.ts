import { describe, it, expect } from "vitest";
import { hourInZone, isWithinDigestWindow } from "../../src/settings/window.js";

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
