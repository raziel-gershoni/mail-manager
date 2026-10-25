import { describe, it, expect } from "vitest";
import { effectiveSettings, type UserSettingsRow } from "../../src/settings/settings.js";
import { ALWAYS_ON, type WeekSchedule } from "../../src/settings/schedule.js";

const h = (from: number, to: number) => ({ from, to });
const OWNER: WeekSchedule = [h(7, 23), h(7, 23), h(7, 23), h(7, 23), h(7, 23), h(7, 15), h(23, 24)];
const row = (o: Partial<UserSettingsRow> = {}): UserSettingsRow =>
  ({ timezone: null, paused: false, language: null, schedule: ALWAYS_ON, ...o });

describe("effectiveSettings", () => {
  it("applies defaults when the row is null (timezone from ownerTz, every day all day)", () => {
    expect(effectiveSettings(null, "Asia/Jerusalem")).toEqual({
      timezone: "Asia/Jerusalem", paused: false, language: "en", schedule: ALWAYS_ON,
    });
  });
  it("defaults timezone to UTC when neither row nor ownerTz has one", () => {
    expect(effectiveSettings(null, undefined)).toEqual({ timezone: "UTC", paused: false, language: "en", schedule: ALWAYS_ON });
  });
  it("uses the row's values when present (row timezone overrides ownerTz)", () => {
    expect(effectiveSettings(row({ timezone: "Europe/Paris", paused: true, schedule: OWNER }), "Asia/Jerusalem")).toEqual({
      timezone: "Europe/Paris", paused: true, language: "en", schedule: OWNER,
    });
  });
  it("falls back to ownerTz when the row's timezone is null", () => {
    expect(effectiveSettings(row({ schedule: OWNER }), "Asia/Jerusalem").timezone).toBe("Asia/Jerusalem");
  });
  it("defaults language to en, honors he, ignores junk", () => {
    expect(effectiveSettings(null, "UTC").language).toBe("en");
    expect(effectiveSettings(row({ language: "he" }), "UTC").language).toBe("he");
    expect(effectiveSettings(row({ language: "fr" }), "UTC").language).toBe("en");
  });
  it("hands out the frozen default, which no caller can change", () => {
    expect(Object.isFrozen(effectiveSettings(null, "UTC").schedule)).toBe(true);
  });
});
