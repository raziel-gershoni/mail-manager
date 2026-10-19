// src/weekly/week.ts
// Calendar-week keys for the weekly jobs. Pure.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The LOCAL calendar date and weekday of `now` in `timezone`, read from one formatter so
// the two can never disagree. An unknown timezone falls back to UTC, like window.ts.
function localDate(now: Date, timezone: string): { y: number; m: number; d: number; weekday: number } {
  const read = (tz: string) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", weekday: "short" }).formatToParts(now);
    const get = (type: string): string => parts.find(p => p.type === type)?.value ?? "";
    return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), weekday: WEEKDAYS.indexOf(get("weekday")) };
  };
  try { return read(timezone || "UTC"); } catch { return read("UTC"); }
}

// "YYYY-MM-DD" of the Sunday that starts `now`'s week (Sunday–Saturday) in `timezone`.
// The day arithmetic runs on a UTC date built from the LOCAL calendar date, so the
// zone's offset and DST changes can't shift the result by a day.
export function weekKey(now: Date, timezone: string): string {
  const { y, m, d, weekday } = localDate(now, timezone);
  return new Date(Date.UTC(y, m - 1, d - weekday)).toISOString().slice(0, 10);
}
