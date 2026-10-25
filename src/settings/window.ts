// src/settings/window.ts
// When a user's hourly brief runs: their local weekday and hour, checked against their
// weekly schedule. Pure.
import { isScheduledAt, type WeekSchedule } from "./schedule.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The local weekday (0 = Sunday … 6 = Saturday) and hour (0–23) of `now` in `timezone`,
// read in one call so the two can't disagree. A bad or empty zone falls back to UTC.
export function localWeekdayHour(now: Date, timezone: string): { weekday: number; hour: number } {
  const read = (tz: string) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
    const hour = parseInt(part("hour"), 10);
    // Some ICU builds render midnight as "24"; left as is, every all-day day would be
    // skipped at midnight.
    return { weekday: WEEKDAYS.indexOf(part("weekday")), hour: hour === 24 ? 0 : hour };
  };
  try { return read(timezone || "UTC"); } catch { return read("UTC"); }
}

// Is `now` inside the user's weekly schedule, in their own timezone? See isScheduledAt.
export function isScheduledNow(now: Date, timezone: string, schedule: WeekSchedule): boolean {
  const { weekday, hour } = localWeekdayHour(now, timezone);
  return isScheduledAt(schedule, weekday, hour);
}
