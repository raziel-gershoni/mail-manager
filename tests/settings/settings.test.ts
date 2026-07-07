import { describe, it, expect } from "vitest";
import { effectiveSettings } from "../../src/settings/settings.js";

describe("effectiveSettings", () => {
  it("applies defaults when the row is null (timezone from ownerTz)", () => {
    expect(effectiveSettings(null, "Asia/Jerusalem")).toEqual({
      timezone: "Asia/Jerusalem", digestStartHour: 0, digestEndHour: 24, paused: false, language: "en",
    });
  });
  it("defaults timezone to UTC when neither row nor ownerTz has one", () => {
    expect(effectiveSettings(null, undefined)).toEqual({
      timezone: "UTC", digestStartHour: 0, digestEndHour: 24, paused: false, language: "en",
    });
  });
  it("uses the row's values when present (row timezone overrides ownerTz)", () => {
    expect(effectiveSettings({ timezone: "Europe/Paris", digestStartHour: 9, digestEndHour: 23, paused: true, language: null }, "Asia/Jerusalem")).toEqual({
      timezone: "Europe/Paris", digestStartHour: 9, digestEndHour: 23, paused: true, language: "en",
    });
  });
  it("falls back to ownerTz when the row's timezone is null", () => {
    expect(effectiveSettings({ timezone: null, digestStartHour: 9, digestEndHour: 23, paused: false, language: null }, "Asia/Jerusalem").timezone).toBe("Asia/Jerusalem");
  });
  it("defaults language to en, honors he, ignores junk", () => {
    expect(effectiveSettings(null, "UTC").language).toBe("en");
    expect(effectiveSettings({ timezone: null, digestStartHour: 0, digestEndHour: 24, paused: false, language: "he" }, "UTC").language).toBe("he");
    expect(effectiveSettings({ timezone: null, digestStartHour: 0, digestEndHour: 24, paused: false, language: "fr" }, "UTC").language).toBe("en");
  });
});
