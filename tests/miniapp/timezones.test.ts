import { describe, it, expect } from "vitest";
import { timezoneOptions } from "../../app/miniapp/timezones.js";

describe("timezoneOptions", () => {
  it("lists the current zone first, once", () => {
    expect(timezoneOptions("Asia/Jerusalem", ["Africa/Cairo", "Asia/Jerusalem", "Europe/Paris"]))
      .toEqual(["Asia/Jerusalem", "Africa/Cairo", "Europe/Paris"]);
  });
  it("adds the current zone when the browser's list lacks it (V8 leaves out UTC)", () => {
    expect(timezoneOptions("UTC", ["Africa/Cairo"])).toEqual(["UTC", "Africa/Cairo"]);
  });
  it("is null when the browser can't list zones, so the screen uses a text field", () => {
    expect(timezoneOptions("UTC", undefined)).toBeNull();
    expect(timezoneOptions("UTC", [])).toBeNull();
  });
});
