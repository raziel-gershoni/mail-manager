import { describe, it, expect } from "vitest";
import {
  ALL_DAY, ALWAYS_ON, dayRuns, enableDay, formatHour, groupSchedule, isOvernight, isScheduledAt, isValidSchedule,
  type WeekSchedule,
} from "../../src/settings/schedule.js";

const off = null;
const h = (from: number, to: number) => ({ from, to });
// Sun–Thu 07–23, Fri 07–15, Sat 23–24 (one check at 23:00): the owner's example.
const OWNER: WeekSchedule = [h(7, 23), h(7, 23), h(7, 23), h(7, 23), h(7, 23), h(7, 15), h(23, 24)];

describe("ALWAYS_ON", () => {
  it("is every day, all day, and can't be changed by a caller", () => {
    expect(ALWAYS_ON).toEqual(Array(7).fill({ from: 0, to: 24 }));
    expect(Object.isFrozen(ALWAYS_ON)).toBe(true);
    expect(Object.isFrozen(ALL_DAY)).toBe(true);
  });
});

describe("isValidSchedule", () => {
  it("accepts the default, the owner's week, a single day, overnight, and from = to", () => {
    expect(isValidSchedule(ALWAYS_ON)).toBe(true);
    expect(isValidSchedule(OWNER)).toBe(true);
    expect(isValidSchedule([off, off, off, off, off, off, h(23, 24)])).toBe(true);
    expect(isValidSchedule([h(22, 2), off, off, off, off, off, off])).toBe(true);
    expect(isValidSchedule([h(9, 9), off, off, off, off, off, off])).toBe(true);
  });
  it("rejects a wrong length or a non-array", () => {
    expect(isValidSchedule(ALWAYS_ON.slice(0, 6))).toBe(false);
    expect(isValidSchedule([...ALWAYS_ON, ALL_DAY])).toBe(false);
    expect(isValidSchedule(null)).toBe(false);
    expect(isValidSchedule({ 0: ALL_DAY })).toBe(false);
    expect(isValidSchedule("[]")).toBe(false);
  });
  it("rejects every day off: stopping all briefs is Pause briefs", () => {
    expect(isValidSchedule(Array(7).fill(null))).toBe(false);
  });
  it("rejects out-of-range, non-integer, missing or extra fields", () => {
    const one = (d: unknown) => [d, off, off, off, off, off, ALL_DAY];
    expect(isValidSchedule(one(h(24, 24)))).toBe(false); // from max 23
    expect(isValidSchedule(one(h(-1, 5)))).toBe(false);
    expect(isValidSchedule(one(h(5, 0)))).toBe(false);   // to min 1
    expect(isValidSchedule(one(h(5, 25)))).toBe(false);
    expect(isValidSchedule(one(h(7.5, 9)))).toBe(false);
    expect(isValidSchedule(one({ from: "7", to: 9 }))).toBe(false);
    expect(isValidSchedule(one({ from: 7 }))).toBe(false);
    expect(isValidSchedule(one({ from: 7, to: 9, note: "x" }))).toBe(false);
    expect(isValidSchedule(one([7, 9]))).toBe(false);
    expect(isValidSchedule(one(undefined))).toBe(false);
    expect(isValidSchedule(one(false))).toBe(false);
  });
});

describe("isOvernight", () => {
  it("is true when to is at or before from", () => {
    expect(isOvernight(h(22, 2))).toBe(true);
    expect(isOvernight(h(9, 9))).toBe(true);
    expect(isOvernight(h(7, 23))).toBe(false);
    expect(isOvernight(h(0, 24))).toBe(false);
  });
});

describe("isScheduledAt", () => {
  it("covers [from, to): the to hour itself is not checked", () => {
    expect(isScheduledAt(OWNER, 0, 6)).toBe(false);
    expect(isScheduledAt(OWNER, 0, 7)).toBe(true);
    expect(isScheduledAt(OWNER, 0, 22)).toBe(true);
    expect(isScheduledAt(OWNER, 0, 23)).toBe(false);
    expect(isScheduledAt(OWNER, 5, 14)).toBe(true); // Fri 14:00, the last Friday check
    expect(isScheduledAt(OWNER, 5, 15)).toBe(false);
  });
  it("a one-hour day runs exactly once", () => {
    const sat = Array.from({ length: 24 }, (_, hr) => hr).filter(hr => isScheduledAt(OWNER, 6, hr));
    expect(sat).toEqual([23]);
  });
  it("all day covers every hour, midnight included", () => {
    for (let hr = 0; hr < 24; hr++) expect(isScheduledAt(ALWAYS_ON, 3, hr)).toBe(true);
  });
  it("an off day is never checked", () => {
    const s: WeekSchedule = [ALL_DAY, off, ALL_DAY, ALL_DAY, ALL_DAY, ALL_DAY, ALL_DAY];
    for (let hr = 0; hr < 24; hr++) expect(isScheduledAt(s, 1, hr)).toBe(false);
  });
  it("overnight hours run past midnight, on both sides", () => {
    const thu: WeekSchedule = [off, off, off, off, h(22, 2), off, off];
    expect(isScheduledAt(thu, 4, 21)).toBe(false);
    expect(isScheduledAt(thu, 4, 22)).toBe(true);
    expect(isScheduledAt(thu, 4, 23)).toBe(true);
    expect(isScheduledAt(thu, 5, 0)).toBe(true);  // Fri 00:00 is still Thursday night
    expect(isScheduledAt(thu, 5, 1)).toBe(true);
    expect(isScheduledAt(thu, 5, 2)).toBe(false);
    expect(isScheduledAt(thu, 4, 1)).toBe(false); // Thu 01:00 would be Wednesday night, which is off
  });
  it("the night belongs to the day it starts on, even into an off day", () => {
    const friNight: WeekSchedule = [off, off, off, off, off, h(22, 6), off];
    expect(isScheduledAt(friNight, 6, 5)).toBe(true); // Saturday is off, but this is Friday night
    expect(isScheduledAt(friNight, 6, 6)).toBe(false);
  });
  it("Saturday night runs into Sunday morning", () => {
    const satNight: WeekSchedule = [off, off, off, off, off, off, h(23, 1)];
    expect(isScheduledAt(satNight, 6, 23)).toBe(true);
    expect(isScheduledAt(satNight, 0, 0)).toBe(true);
    expect(isScheduledAt(satNight, 0, 1)).toBe(false);
  });
  it("from = to is a full 24 hours starting at from", () => {
    const tue: WeekSchedule = [off, off, h(9, 9), off, off, off, off];
    expect(isScheduledAt(tue, 2, 8)).toBe(false);
    expect(isScheduledAt(tue, 2, 9)).toBe(true);
    expect(isScheduledAt(tue, 2, 23)).toBe(true);
    expect(isScheduledAt(tue, 3, 8)).toBe(true);
    expect(isScheduledAt(tue, 3, 9)).toBe(false);
  });
  it("today's own hours and last night's tail both count", () => {
    const s: WeekSchedule = [h(20, 3), h(7, 9), off, off, off, off, off];
    expect(isScheduledAt(s, 1, 2)).toBe(true);  // Sunday night's tail
    expect(isScheduledAt(s, 1, 5)).toBe(false);
    expect(isScheduledAt(s, 1, 8)).toBe(true);  // Monday's own hours
  });
});

describe("groupSchedule", () => {
  it("is one group when every day is the same", () => {
    expect(groupSchedule(ALWAYS_ON)).toEqual([{ days: [0, 1, 2, 3, 4, 5, 6], hours: { from: 0, to: 24 } }]);
  });
  it("groups the owner's week in order of each group's first day", () => {
    expect(groupSchedule(OWNER)).toEqual([
      { days: [0, 1, 2, 3, 4], hours: { from: 7, to: 23 } },
      { days: [5], hours: { from: 7, to: 15 } },
      { days: [6], hours: { from: 23, to: 24 } },
    ]);
  });
  it("groups non-consecutive days and off days", () => {
    const s: WeekSchedule = [h(8, 20), off, h(8, 20), h(8, 20), off, h(9, 12), off];
    expect(groupSchedule(s)).toEqual([
      { days: [0, 2, 3], hours: { from: 8, to: 20 } },
      { days: [1, 4, 6], hours: null },
      { days: [5], hours: { from: 9, to: 12 } },
    ]);
  });
  it("handles all off but one", () => {
    expect(groupSchedule([off, off, off, h(10, 11), off, off, off])).toEqual([
      { days: [0, 1, 2, 4, 5, 6], hours: null },
      { days: [3], hours: { from: 10, to: 11 } },
    ]);
  });
});

describe("dayRuns", () => {
  it("collapses consecutive days", () => {
    expect(dayRuns([0, 1, 2, 3, 4])).toEqual([{ first: 0, last: 4 }]);
    expect(dayRuns([0, 2, 3])).toEqual([{ first: 0, last: 0 }, { first: 2, last: 3 }]);
    expect(dayRuns([5])).toEqual([{ first: 5, last: 5 }]);
  });
  it("sorts and dedupes, and doesn't wrap Saturday into Sunday", () => {
    expect(dayRuns([6, 0])).toEqual([{ first: 0, last: 0 }, { first: 6, last: 6 }]);
    expect(dayRuns([3, 1, 2, 2])).toEqual([{ first: 1, last: 3 }]);
    expect(dayRuns([])).toEqual([]);
  });
});

describe("enableDay", () => {
  it("copies the hours of the nearest earlier day that's on", () => {
    const s: WeekSchedule = [h(7, 23), off, off, h(9, 17), off, off, off];
    expect(enableDay(s, 2)[2]).toEqual({ from: 7, to: 23 }); // Monday is off too → Sunday
    expect(enableDay(s, 4)[4]).toEqual({ from: 9, to: 17 }); // Wednesday
  });
  it("counts Saturday as the day before Sunday", () => {
    const s: WeekSchedule = [off, off, off, off, off, off, h(23, 24)];
    expect(enableDay(s, 0)[0]).toEqual({ from: 23, to: 24 });
  });
  it("starts all day when every day is off", () => {
    expect(enableDay(Array(7).fill(null), 3)[3]).toEqual({ from: 0, to: 24 });
  });
  it("returns a new array, leaves the other days alone, and keeps a day that's already on", () => {
    const s: WeekSchedule = [h(7, 23), off, off, off, off, off, off];
    const next = enableDay(s, 1);
    expect(next).not.toBe(s);
    expect(s[1]).toBeNull();
    expect(next).toEqual([h(7, 23), h(7, 23), off, off, off, off, off]);
    expect(enableDay(s, 0)).toEqual(s);
  });
  it("never hands out the frozen ALL_DAY object", () => {
    const next = enableDay(Array(7).fill(null), 0);
    expect(next[0]).not.toBe(ALL_DAY);
    expect(Object.isFrozen(next[0])).toBe(false);
  });
});

describe("formatHour", () => {
  it("is 24-hour hh:00", () => {
    expect(formatHour(0)).toBe("00:00");
    expect(formatHour(7)).toBe("07:00");
    expect(formatHour(24)).toBe("24:00");
  });
});
