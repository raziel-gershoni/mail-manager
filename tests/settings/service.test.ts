import { describe, it, expect } from "vitest";
import { buildSettingsView, validateSettingsPatch, mergePatch, LEGACY_PATCH_ERROR } from "../../src/settings/service.js";
import type { EffectiveSettings } from "../../src/settings/settings.js";
import { ALWAYS_ON, type WeekSchedule } from "../../src/settings/schedule.js";

const h = (from: number, to: number) => ({ from, to });
const OWNER: WeekSchedule = [h(7, 23), h(7, 23), h(7, 23), h(7, 23), h(7, 23), h(7, 15), h(23, 24)];
const eff: EffectiveSettings = { timezone: "UTC", paused: false, language: "en", schedule: ALWAYS_ON };

describe("validateSettingsPatch", () => {
  it("accepts a valid partial patch", () => {
    expect(validateSettingsPatch({ paused: true, timezone: "Asia/Jerusalem", schedule: OWNER }))
      .toEqual({ paused: true, timezone: "Asia/Jerusalem", schedule: OWNER });
  });
  it("rejects a bad tz, a non-boolean paused, and a non-object", () => {
    expect(validateSettingsPatch({ timezone: "Not/AZone" })).toHaveProperty("error");
    expect(validateSettingsPatch({ paused: "yes" })).toHaveProperty("error");
    expect(validateSettingsPatch(null)).toHaveProperty("error");
    expect(validateSettingsPatch([])).toHaveProperty("error");
  });
  it("accepts language en|he and rejects others", () => {
    expect(validateSettingsPatch({ language: "he" })).toEqual({ language: "he" });
    expect(validateSettingsPatch({ language: "en" })).toEqual({ language: "en" });
    expect(validateSettingsPatch({ language: "fr" })).toHaveProperty("error");
    expect(validateSettingsPatch({ language: 3 })).toHaveProperty("error");
  });
  it("rejects an invalid schedule", () => {
    expect(validateSettingsPatch({ schedule: Array(7).fill(null) })).toEqual({ error: "invalid schedule" }); // "Pause briefs" covers none
    expect(validateSettingsPatch({ schedule: OWNER.slice(0, 6) })).toEqual({ error: "invalid schedule" });
    expect(validateSettingsPatch({ schedule: [h(7, 25), null, null, null, null, null, null] })).toEqual({ error: "invalid schedule" });
    expect(validateSettingsPatch({ schedule: "every day" })).toEqual({ error: "invalid schedule" });
  });
  it("rejects a save from the old settings screen, so it shows Save failed instead of Saved", () => {
    expect(LEGACY_PATCH_ERROR).toBe("settings app updated — reopen it");
    for (const legacy of [{ digestStartHour: 8 }, { digestEndHour: 22 }, { activeDays: [0, 1] }, { paused: true, activeDays: [0] }]) {
      expect(validateSettingsPatch(legacy)).toEqual({ error: LEGACY_PATCH_ERROR });
    }
  });
  it("ignores other unknown keys", () => {
    expect(validateSettingsPatch({ paused: true, theme: "dark" })).toEqual({ paused: true });
  });
});

describe("mergePatch", () => {
  it("overlays only provided fields onto the effective settings", () => {
    expect(mergePatch(eff, { paused: true })).toEqual({ timezone: "UTC", paused: true, language: "en", schedule: ALWAYS_ON });
  });
  it("overlays language when provided", () => {
    expect(mergePatch(eff, { language: "he" }).language).toBe("he");
  });
  it("overlays the schedule when provided, keeps it otherwise", () => {
    expect(mergePatch(eff, { schedule: OWNER }).schedule).toEqual(OWNER);
    expect(mergePatch({ ...eff, schedule: OWNER }, { paused: true }).schedule).toEqual(OWNER);
  });
});

describe("buildSettingsView", () => {
  it("assembles settings + gmail status + read-only rules", () => {
    const rules = [
      { userId: 1, slug: "sender:x@y.com", description: "", body: "", scope: "sender", matchType: "sender", matchValue: "x@y.com", verdict: "important", action: null },
      { userId: 1, slug: "domain:linkedin.com", description: "", body: "", scope: "domain", matchType: "domain", matchValue: "linkedin.com", verdict: "unimportant", action: "trash" },
      { userId: 1, slug: "domain:shop.com", description: "", body: "", scope: "domain", matchType: "domain", matchValue: "shop.com", verdict: "unimportant", action: "review" },
      { userId: 1, slug: "domain:list.com", description: "", body: "", scope: "domain", matchType: "domain", matchValue: "list.com", verdict: "unimportant", action: "review_archive" },
      { userId: 1, slug: "domain:leave.com", description: "", body: "", scope: "domain", matchType: "domain", matchValue: "leave.com", verdict: "unimportant", action: "keep" },
      { userId: 1, slug: "note", description: "n", body: "", scope: "global", matchType: null, matchValue: null, verdict: null, action: null },
    ];
    const usage = { totalTokens: 1200, systemTokens: 800, summaryTokens: 100, windowTokens: 300, windowTurns: 4, compactAtTokens: 40000 };
    const view = buildSettingsView(eff, { email: "me@gmail.com", needsReconnect: true }, rules, usage);
    expect(view.gmail).toEqual({ email: "me@gmail.com", connected: true, needsReconnect: true });
    expect(view.context).toEqual(usage); // context usage is passed through to the view
    expect(view.schedule).toEqual(ALWAYS_ON); // settings pass straight through to the mini app
    expect(view.rules).toEqual([ // only match rules; review → "guarded trash", review_archive → "guarded archive", keep → "keep"
      { matchValue: "x@y.com", scope: "sender", verdict: "important", action: "" },
      { matchValue: "linkedin.com", scope: "domain", verdict: "unimportant", action: "trash" },
      { matchValue: "shop.com", scope: "domain", verdict: "unimportant", action: "guarded trash" },
      { matchValue: "list.com", scope: "domain", verdict: "unimportant", action: "guarded archive" },
      { matchValue: "leave.com", scope: "domain", verdict: "unimportant", action: "keep" },
    ]);
    expect(view.paused).toBe(false);
  });
  it("carries language into the view so the client can localize", () => {
    const usage = { totalTokens: 0, systemTokens: 0, summaryTokens: 0, windowTokens: 0, windowTurns: 0, compactAtTokens: 40000 };
    expect(buildSettingsView({ ...eff, language: "he" }, null, [], usage).language).toBe("he");
  });
  it("reports disconnected when there is no account", () => {
    const usage = { totalTokens: 0, systemTokens: 0, summaryTokens: 0, windowTokens: 0, windowTurns: 0, compactAtTokens: 40000 };
    expect(buildSettingsView(eff, null, [], usage).gmail).toEqual({ email: null, connected: false, needsReconnect: false });
  });
});
