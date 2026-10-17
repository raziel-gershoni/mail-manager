import { describe, it, expect } from "vitest";
import { effectiveSettings, ALL_DAYS, type UserSettingsRow } from "../../src/settings/settings.js";

const ALL = [0, 1, 2, 3, 4, 5, 6];
const row = (o: Partial<UserSettingsRow> = {}): UserSettingsRow =>
  ({ timezone: null, digestStartHour: 0, digestEndHour: 24, paused: false, language: null, activeDays: ALL, ...o });

describe("effectiveSettings", () => {
  it("applies defaults when the row is null (timezone from ownerTz, all days active)", () => {
    expect(effectiveSettings(null, "Asia/Jerusalem")).toEqual({
      timezone: "Asia/Jerusalem", digestStartHour: 0, digestEndHour: 24, paused: false, language: "en", activeDays: ALL,
    });
  });
  it("defaults timezone to UTC when neither row nor ownerTz has one", () => {
    expect(effectiveSettings(null, undefined)).toEqual({
      timezone: "UTC", digestStartHour: 0, digestEndHour: 24, paused: false, language: "en", activeDays: ALL,
    });
  });
  it("uses the row's values when present (row timezone overrides ownerTz)", () => {
    expect(effectiveSettings(row({ timezone: "Europe/Paris", digestStartHour: 9, digestEndHour: 23, paused: true, activeDays: [0, 1, 2, 3, 4, 5] }), "Asia/Jerusalem")).toEqual({
      timezone: "Europe/Paris", digestStartHour: 9, digestEndHour: 23, paused: true, language: "en", activeDays: [0, 1, 2, 3, 4, 5],
    });
  });
  it("falls back to ownerTz when the row's timezone is null", () => {
    expect(effectiveSettings(row({ digestStartHour: 9, digestEndHour: 23 }), "Asia/Jerusalem").timezone).toBe("Asia/Jerusalem");
  });
  it("defaults language to en, honors he, ignores junk", () => {
    expect(effectiveSettings(null, "UTC").language).toBe("en");
    expect(effectiveSettings(row({ language: "he" }), "UTC").language).toBe("he");
    expect(effectiveSettings(row({ language: "fr" }), "UTC").language).toBe("en");
  });
  it("hands out a fresh default array, never the shared ALL_DAYS constant", () => {
    const a = effectiveSettings(null, "UTC").activeDays;
    a.pop();
    expect(ALL_DAYS).toEqual(ALL);
  });
});
