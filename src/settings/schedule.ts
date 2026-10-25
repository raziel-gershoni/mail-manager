// src/settings/schedule.ts
// The weekly brief schedule. Pure.
//
// Each weekday is either off (null) or has its own whole-hour window [from, to) in the
// user's timezone. `to ≤ from` means the hours run past midnight: the night belongs to
// the day it starts on, even when the next day is off. `from = to` is a full 24 hours
// starting at `from`.

export interface DayHours { from: number; to: number }   // from 0–23, to 1–24; to ≤ from → overnight
// Exactly 7 entries, index 0 = Sunday … 6 = Saturday; null = off.
export type WeekSchedule = ReadonlyArray<Readonly<DayHours> | null>;

export const ALL_DAY: Readonly<DayHours> = Object.freeze({ from: 0, to: 24 });
export const ALWAYS_ON: WeekSchedule = Object.freeze(Array.from({ length: 7 }, () => ALL_DAY));

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

// Exactly {from, to}: two keys, both whole hours in range.
function isDayHours(v: unknown): v is DayHours {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return Object.keys(o).length === 2 && isInt(o.from, 0, 23) && isInt(o.to, 1, 24);
}

// Seven days, each off or exactly {from, to}, and at least one day on: stopping all
// briefs is "Pause briefs", not an empty schedule.
export function isValidSchedule(v: unknown): v is WeekSchedule {
  return Array.isArray(v) && v.length === 7
    && v.every(d => d === null || isDayHours(d))
    && v.some(d => d !== null);
}

export function isOvernight(h: DayHours): boolean {
  return h.to <= h.from;
}

// Is `hour` on `weekday` (both local) inside the schedule? Either today's own hours
// cover it, or last night's overnight hours are still running.
export function isScheduledAt(schedule: WeekSchedule, weekday: number, hour: number): boolean {
  const today = schedule[weekday];
  if (today && hour >= today.from && (isOvernight(today) || hour < today.to)) return true;
  const yesterday = schedule[(weekday + 6) % 7];
  return !!yesterday && isOvernight(yesterday) && hour < yesterday.to;
}

export interface ScheduleGroup { days: number[]; hours: DayHours | null }

// Days with identical hours (off days together), in order of each group's first day.
export function groupSchedule(schedule: WeekSchedule): ScheduleGroup[] {
  const groups = new Map<string, ScheduleGroup>();
  schedule.forEach((h, day) => {
    const key = h ? `${h.from}-${h.to}` : "off";
    const group = groups.get(key);
    if (group) group.days.push(day);
    else groups.set(key, { days: [day], hours: h ? { from: h.from, to: h.to } : null });
  });
  return [...groups.values()];
}

export interface DayRun { first: number; last: number }

// Consecutive runs within Sun→Sat: [0,1,2,3,4] → Sun–Thu, [0,2,3] → Sun, Tue–Wed.
export function dayRuns(days: readonly number[]): DayRun[] {
  const runs: DayRun[] = [];
  for (const d of [...new Set(days)].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && d === last.last + 1) last.last = d;
    else runs.push({ first: d, last: d });
  }
  return runs;
}

// Turning a day on: it starts with the hours of the nearest earlier day that's on
// (Saturday counts as the day before Sunday), or all day when every day is off. A day
// that's already on keeps its hours.
export function enableDay(schedule: WeekSchedule, day: number): Array<DayHours | null> {
  const copy = schedule.map(h => (h ? { from: h.from, to: h.to } : null));
  if (copy[day]) return copy;
  let hours: DayHours = { from: ALL_DAY.from, to: ALL_DAY.to };
  for (let back = 1; back < 7; back++) {
    const h = schedule[(day + 7 - back) % 7];
    if (h) { hours = { from: h.from, to: h.to }; break; }
  }
  copy[day] = hours;
  return copy;
}

export function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}
