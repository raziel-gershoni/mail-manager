import { describe, it, expect } from "vitest";
import { buildSettingsView, validateSettingsPatch, mergePatch } from "../../src/settings/service.js";
import type { EffectiveSettings } from "../../src/settings/settings.js";

const eff: EffectiveSettings = { timezone: "UTC", digestStartHour: 0, digestEndHour: 24, paused: false };

describe("validateSettingsPatch", () => {
  it("accepts a valid partial patch", () => {
    expect(validateSettingsPatch({ digestStartHour: 8, digestEndHour: 22, paused: true, timezone: "Asia/Jerusalem" }))
      .toEqual({ digestStartHour: 8, digestEndHour: 22, paused: true, timezone: "Asia/Jerusalem" });
  });
  it("rejects out-of-range hours, bad tz, non-boolean paused, non-object", () => {
    expect(validateSettingsPatch({ digestStartHour: 24 })).toHaveProperty("error"); // start max 23
    expect(validateSettingsPatch({ digestEndHour: 25 })).toHaveProperty("error");
    expect(validateSettingsPatch({ timezone: "Not/AZone" })).toHaveProperty("error");
    expect(validateSettingsPatch({ paused: "yes" })).toHaveProperty("error");
    expect(validateSettingsPatch(null)).toHaveProperty("error");
    expect(validateSettingsPatch([])).toHaveProperty("error");
  });
  it("allows digestEndHour 24 (always-on end)", () => {
    expect(validateSettingsPatch({ digestEndHour: 24 })).toEqual({ digestEndHour: 24 });
  });
});

describe("mergePatch", () => {
  it("overlays only provided fields onto the effective settings", () => {
    expect(mergePatch(eff, { paused: true })).toEqual({ timezone: "UTC", digestStartHour: 0, digestEndHour: 24, paused: true });
  });
});

describe("buildSettingsView", () => {
  it("assembles settings + gmail status + read-only rules", () => {
    const rules = [
      { userId: 1, slug: "sender:x@y.com", description: "", body: "", scope: "sender", matchType: "sender", matchValue: "x@y.com", verdict: "important", action: null },
      { userId: 1, slug: "domain:linkedin.com", description: "", body: "", scope: "domain", matchType: "domain", matchValue: "linkedin.com", verdict: "unimportant", action: "trash" },
      { userId: 1, slug: "domain:shop.com", description: "", body: "", scope: "domain", matchType: "domain", matchValue: "shop.com", verdict: "unimportant", action: "review" },
      { userId: 1, slug: "note", description: "n", body: "", scope: "global", matchType: null, matchValue: null, verdict: null, action: null },
    ];
    const view = buildSettingsView(eff, { email: "me@gmail.com", needsReconnect: true }, rules);
    expect(view.gmail).toEqual({ email: "me@gmail.com", connected: true, needsReconnect: true });
    expect(view.rules).toEqual([ // only match rules, carrying scope/verdict/action; "review" shows as "guarded trash"
      { matchValue: "x@y.com", scope: "sender", verdict: "important", action: "" },
      { matchValue: "linkedin.com", scope: "domain", verdict: "unimportant", action: "trash" },
      { matchValue: "shop.com", scope: "domain", verdict: "unimportant", action: "guarded trash" },
    ]);
    expect(view.paused).toBe(false);
  });
  it("reports disconnected when there is no account", () => {
    expect(buildSettingsView(eff, null, []).gmail).toEqual({ email: null, connected: false, needsReconnect: false });
  });
});
