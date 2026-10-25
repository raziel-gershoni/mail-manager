import { isScheduledAt, type WeekSchedule } from "./schedule.js";

// Timezone-aware digest-window predicate. Pure.
export function hourInZone(now: Date, timezone: string): number {
  const zone = timezone || "UTC";
  const read = (tz: string): number => {
    const s = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(now);
    const h = parseInt(s, 10);
    return h === 24 ? 0 : h; // some ICU builds render midnight as "24"
  };
  try { return read(zone); } catch { return read("UTC"); }
}

// True if `now` (in `timezone`) is within [startHour, endHour). Supports overnight
// wrap (start > end). startHour === endHour means a full-day (always-on) window.
export function isWithinDigestWindow(now: Date, timezone: string, startHour: number, endHour: number): boolean {
  const hour = hourInZone(now, timezone);
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Day of the week (0 = Sunday … 6 = Saturday) of `now` in `timezone`. Pure.
export function weekdayInZone(now: Date, timezone: string): number {
  const read = (tz: string): number =>
    WEEKDAYS.indexOf(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now));
  try { return read(timezone || "UTC"); } catch { return read("UTC"); }
}

// True if `now` (in `timezone`) falls on one of `activeDays`. The LOCAL date decides, so
// an overnight active-hours window stops at midnight going into an inactive day.
export function isActiveDay(now: Date, timezone: string, activeDays: readonly number[]): boolean {
  return activeDays.includes(weekdayInZone(now, timezone));
}

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
