import { describe, it, expect } from "vitest";
import { buildSettingsView, validateSettingsPatch, mergePatch } from "../../src/settings/service.js";
import type { EffectiveSettings } from "../../src/settings/settings.js";

const eff: EffectiveSettings = { timezone: "UTC", digestStartHour: 0, digestEndHour: 24, paused: false, language: "en", activeDays: [0, 1, 2, 3, 4, 5, 6] };

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
  it("accepts language en|he and rejects others", () => {
    expect(validateSettingsPatch({ language: "he" })).toEqual({ language: "he" });
    expect(validateSettingsPatch({ language: "en" })).toEqual({ language: "en" });
    expect(validateSettingsPatch({ language: "fr" })).toHaveProperty("error");
    expect(validateSettingsPatch({ language: 3 })).toHaveProperty("error");
  });
  it("accepts activeDays and normalizes them to ascending order", () => {
    expect(validateSettingsPatch({ activeDays: [6, 0, 3] })).toEqual({ activeDays: [0, 3, 6] });
    expect(validateSettingsPatch({ activeDays: [0, 1, 2, 3, 4, 5, 6] })).toEqual({ activeDays: [0, 1, 2, 3, 4, 5, 6] });
  });
  it("rejects empty, duplicate, out-of-range, non-integer and non-array activeDays", () => {
    expect(validateSettingsPatch({ activeDays: [] })).toEqual({ error: "invalid activeDays" });   // "Pause briefs" covers none
    expect(validateSettingsPatch({ activeDays: [1, 1] })).toEqual({ error: "invalid activeDays" });
    expect(validateSettingsPatch({ activeDays: [7] })).toEqual({ error: "invalid activeDays" });
    expect(validateSettingsPatch({ activeDays: [-1] })).toEqual({ error: "invalid activeDays" });
    expect(validateSettingsPatch({ activeDays: [1.5] })).toEqual({ error: "invalid activeDays" });
    expect(validateSettingsPatch({ activeDays: ["1"] })).toEqual({ error: "invalid activeDays" });
    expect(validateSettingsPatch({ activeDays: 1 })).toEqual({ error: "invalid activeDays" });
  });
});

describe("mergePatch", () => {
  it("overlays only provided fields onto the effective settings", () => {
    expect(mergePatch(eff, { paused: true })).toEqual({ timezone: "UTC", digestStartHour: 0, digestEndHour: 24, paused: true, language: "en", activeDays: [0, 1, 2, 3, 4, 5, 6] });
  });
  it("overlays language when provided", () => {
    expect(mergePatch(eff, { language: "he" }).language).toBe("he");
  });
  it("overlays activeDays when provided, keeps them otherwise", () => {
    expect(mergePatch(eff, { activeDays: [0, 1, 2, 3, 4, 5] }).activeDays).toEqual([0, 1, 2, 3, 4, 5]);
    expect(mergePatch(eff, { paused: true }).activeDays).toEqual([0, 1, 2, 3, 4, 5, 6]);
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
    expect(view.activeDays).toEqual([0, 1, 2, 3, 4, 5, 6]); // settings pass straight through to the mini app
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
