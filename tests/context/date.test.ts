import { describe, it, expect } from "vitest";
import { dateContext } from "../../src/context/date.js";

// A fixed instant: 2026-07-02 11:30 UTC (Israel is UTC+3 in July → 14:30).
const FIXED = new Date("2026-07-02T11:30:00Z");

describe("dateContext", () => {
  it("formats in the given timezone", () => {
    const out = dateContext(FIXED, "Asia/Jerusalem");
    expect(out).toContain("2026");
    expect(out).toContain("July");
    expect(out).toContain("14:30");
    expect(out).toContain("(Asia/Jerusalem)");
  });

  it("uses UTC when tz is UTC", () => {
    const out = dateContext(FIXED, "UTC");
    expect(out).toContain("11:30");
    expect(out).toContain("(UTC)");
  });

  it("falls back to UTC on an invalid timezone", () => {
    const out = dateContext(FIXED, "Not/AZone");
    expect(out).toContain("(UTC)");
    expect(out).toContain("11:30");
  });

  it("falls back to UTC on an empty timezone", () => {
    expect(dateContext(FIXED, "")).toContain("(UTC)");
  });
});
