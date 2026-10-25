// src/settings/schedule-text.ts
// How the settings screen words a weekly schedule. Pure.
import { t, type Lang, type MsgKey } from "../i18n/index.js";
import { dayRuns, formatHour, isOvernight, type DayHours } from "./schedule.js";

export function dayName(lang: Lang, day: number): string {
  return t(lang, `mini_day_${day}` as MsgKey);
}

// A group's days: "Every day", or runs like "Sun–Thu" and "Sun, Tue–Wed".
export function daysText(days: readonly number[], lang: Lang): string {
  if (new Set(days).size === 7) return t(lang, "mini_every_day");
  return dayRuns(days)
    .map(r => (r.first === r.last ? dayName(lang, r.first) : `${dayName(lang, r.first)}–${dayName(lang, r.last)}`))
    .join(", ");
}

export type HoursText =
  | { kind: "off" }
  | { kind: "all_day" }
  | { kind: "range"; range: string; nextDay: boolean };

// A day's hours as the view shows them: "Off", "All day", or "07:00–23:00" (plus "next
// day" when they run past midnight). The range is its own field so the screen can keep
// it left-to-right inside Hebrew, with "next day" outside it.
export function hoursText(h: DayHours | null): HoursText {
  if (!h) return { kind: "off" };
  if (h.from === 0 && h.to === 24) return { kind: "all_day" };
  return { kind: "range", range: `${formatHour(h.from)}–${formatHour(h.to)}`, nextDay: isOvernight(h) };
}
