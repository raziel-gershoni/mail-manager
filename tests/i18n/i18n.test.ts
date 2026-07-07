import { describe, it, expect } from "vitest";
import { t, dir, normalizeLang, type Lang } from "../../src/i18n/index.js";
import { messages } from "../../src/i18n/messages.js";

describe("i18n", () => {
  it("he has exactly the en keys (no missing/extra translations)", () => {
    const enKeys = Object.keys(messages.en).sort();
    const heKeys = Object.keys(messages.he).sort();
    expect(heKeys).toEqual(enKeys);
  });
  it("every he value is non-empty", () => {
    for (const k of Object.keys(messages.en)) expect((messages.he as Record<string, string>)[k]!.length).toBeGreaterThan(0);
  });
  it("interpolates {params}", () => {
    expect(t("en", "poll_new", { n: 3 })).toContain("3");
    expect(t("he", "poll_new", { n: 7 })).toContain("7");
  });
  it("dir maps he→rtl, en→ltr", () => {
    expect(dir("he")).toBe("rtl");
    expect(dir("en")).toBe("ltr");
  });
  it("normalizeLang accepts only en|he", () => {
    expect(normalizeLang("he")).toBe("he");
    expect(normalizeLang("en")).toBe("en");
    expect(normalizeLang("fr")).toBeUndefined();
    expect(normalizeLang(null)).toBeUndefined();
    expect(normalizeLang(undefined)).toBeUndefined();
  });
  it("t is total (returns a string for any key/lang)", () => {
    const l: Lang = "he";
    expect(typeof t(l, "intro")).toBe("string");
    expect(t(l, "intro").length).toBeGreaterThan(0);
  });
});
