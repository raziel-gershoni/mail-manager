import { describe, it, expect } from "vitest";
import { dayName, daysText, hoursText } from "../../src/settings/schedule-text.js";

describe("dayName", () => {
  it("is the short day name in each language", () => {
    expect(dayName("en", 0)).toBe("Sun");
    expect(dayName("he", 6)).toBe("ש׳");
  });
});

describe("daysText", () => {
  it("is 'Every day' for all seven", () => {
    expect(daysText([0, 1, 2, 3, 4, 5, 6], "en")).toBe("Every day");
    expect(daysText([0, 1, 2, 3, 4, 5, 6], "he")).toBe("כל יום");
  });
  it("words runs and single days", () => {
    expect(daysText([0, 1, 2, 3, 4], "en")).toBe("Sun–Thu");
    expect(daysText([5], "en")).toBe("Fri");
    expect(daysText([0, 2, 3], "en")).toBe("Sun, Tue–Wed");
    expect(daysText([6, 0], "en")).toBe("Sun, Sat");
  });
  it("reads naturally in Hebrew", () => {
    expect(daysText([0, 1, 2, 3, 4], "he")).toBe("א׳–ה׳");
    expect(daysText([0, 2, 3], "he")).toBe("א׳, ג׳–ד׳");
  });
});

describe("hoursText", () => {
  it("is off for an off day, all day for 00–24", () => {
    expect(hoursText(null)).toEqual({ kind: "off" });
    expect(hoursText({ from: 0, to: 24 })).toEqual({ kind: "all_day" });
  });
  it("is a range, flagged next day when it runs past midnight", () => {
    expect(hoursText({ from: 7, to: 23 })).toEqual({ kind: "range", range: "07:00–23:00", nextDay: false });
    expect(hoursText({ from: 7, to: 24 })).toEqual({ kind: "range", range: "07:00–24:00", nextDay: false });
    expect(hoursText({ from: 22, to: 2 })).toEqual({ kind: "range", range: "22:00–02:00", nextDay: true });
    expect(hoursText({ from: 9, to: 9 })).toEqual({ kind: "range", range: "09:00–09:00", nextDay: true });
  });
});
