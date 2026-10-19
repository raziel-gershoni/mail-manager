// src/weekly/gather.ts
// The facts the weekly retrospect reports, for one user over its window: what was
// trashed or archived (with id and why), spam rescues and undos, rule changes, and
// operational issues. Read-only.
import type { ActivityRepo, ActedSource } from "../notifier/activity.js";
import type { ActionLogRepo } from "../cleanup/proposals.js";
import type { MemoryStore } from "../memory/store.js";
import type { OpsEvent, OpsEventRepo } from "../ops/events.js";
import { weekKey } from "./week.js";

export interface WeekFacts {
  acted: { messageId?: string; from: string; subject: string; action: "trashed" | "archived"; source?: ActedSource; at: Date }[]; // oldest first
  rescued: number;      // messages rescued from spam in the window
  undone: number;       // runs undone in the window (whenever they ran)
  rulesNew: number;     // rules/preferences created in the window
  rulesChanged: number; // created before the window, last updated in it (R4). Hard deletes leave no trace, so they aren't counted.
  ops: OpsEvent[];      // oldest first
}

export const RETRO_WINDOW_DAYS = 7;

function zoneOrUtc(timezone: string): string {
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone || "UTC" }); return timezone || "UTC"; }
  catch { return "UTC"; }
}

function wallClock(at: Date, tz: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find(p => p.type === type)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") }; // some ICU builds render midnight as "24"
}

// How far `tz`'s wall clock is ahead of UTC at the instant `at` (negative west of UTC).
function zoneOffsetMs(at: Date, tz: string): number {
  const w = wallClock(at, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(at.getTime() / 1000) * 1000;
}

// The first instant of the local calendar date y-m-d in `tz` (d may run past the month's
// edges; Date.UTC normalizes it). The day arithmetic is on the LOCAL calendar and the
// result is converted back with that night's own UTC offset, so a DST change inside the
// window can't move an edge by an hour. The offset is read a day either side, so both
// sides of a DST change that night are candidates; the earliest one whose local date is
// y-m-d wins. That is local midnight, or 01:00 where the clocks spring forward AT
// midnight (America/Santiago, America/Havana), when 00:00 never happens.
function localMidnight(y: number, m: number, d: number, tz: string): Date {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const midnightAsUtc = Date.UTC(y, m - 1, d);
  const target = new Date(midnightAsUtc).toISOString().slice(0, 10);
  const candidates = [midnightAsUtc - DAY_MS, midnightAsUtc + DAY_MS]
    .map(probe => midnightAsUtc - zoneOffsetMs(new Date(probe), tz))
    .sort((a, b) => a - b);
  const onTheDay = candidates.find(at => {
    const w = wallClock(new Date(at), tz);
    return new Date(Date.UTC(w.y, w.m - 1, w.d)).toISOString().slice(0, 10) === target;
  });
  return new Date(onTheDay ?? candidates[candidates.length - 1]!);
}

// The retrospect's window is the Sunday–Saturday local week BEFORE the one weekKey(now)
// names: [retroSince, retroUntil). It is anchored to the week, not to `now`, so the
// windows of consecutive retros tile — each starts exactly where the last one ended:
// - Sunday's first run (the week's biggest catch-up) records its activity BEFORE the
//   retro runs; that slice is past retroUntil, so it is reported once, next week;
// - a retro that slips past Sunday (every Sunday run out of time) still covers the same
//   week, so no day is skipped or repeated.
// A bad or empty timezone falls back to UTC (like weekKey).
function weekStart(now: Date, timezone: string): { y: number; m: number; d: number; tz: string } {
  const tz = zoneOrUtc(timezone);
  const [y, m, d] = weekKey(now, tz).split("-").map(Number) as [number, number, number];
  return { y, m, d, tz };
}

// Where the window starts: local midnight of the previous week's Sunday.
export function retroSince(now: Date, timezone: string): Date {
  const { y, m, d, tz } = weekStart(now, timezone);
  return localMidnight(y, m, d - RETRO_WINDOW_DAYS, tz);
}

// Where the window ends (exclusive): local midnight of this week's Sunday, the first
// instant of weekKey(now)'s week.
export function retroUntil(now: Date, timezone: string): Date {
  const { y, m, d, tz } = weekStart(now, timezone);
  return localMidnight(y, m, d, tz);
}

// Everything in [since, until): pass retroSince(now, tz) and retroUntil(now, tz).
export async function gatherWeek(deps: {
  userId: number; since: Date; until: Date; activity: ActivityRepo; actionLog: ActionLogRepo; store: MemoryStore; ops: OpsEventRepo;
}): Promise<WeekFacts> {
  const from = deps.since.getTime();
  const to = deps.until.getTime();
  const inWindow = (d: Date): boolean => d.getTime() >= from && d.getTime() < to;
  const [activity, runs, ops] = await Promise.all([
    deps.activity.since(deps.userId, deps.since),
    deps.actionLog.runsSince(deps.userId, deps.since),
    deps.ops.since(deps.userId, deps.since),
  ]);
  // The repos filter by `since` only; both edges are applied here, so the counts never
  // depend on a repo's exact edge semantics and what happened after `until` (this week
  // so far) waits for next week's report.
  const acted = activity
    .filter(r => (r.action === "trashed" || r.action === "archived") && inWindow(r.at))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map(r => ({
      ...(r.messageId ? { messageId: r.messageId } : {}),
      from: r.from, subject: r.subject,
      action: r.action === "trashed" ? "trashed" as const : "archived" as const,
      ...(r.source ? { source: r.source } : {}),
      at: r.at,
    }));
  const rescued = runs.filter(r => r.action === "unspam" && inWindow(r.at)).reduce((n, r) => n + r.messageIds.length, 0);
  const undone = runs.filter(r => r.undoneAt !== null && inWindow(r.undoneAt)).length;
  const rows = deps.store.list();
  const rulesNew = rows.filter(r => r.createdAt !== undefined && inWindow(r.createdAt)).length;
  const rulesChanged = rows.filter(r => r.createdAt !== undefined && r.createdAt.getTime() < from && r.updatedAt !== undefined && inWindow(r.updatedAt)).length;
  return {
    acted, rescued, undone, rulesNew, rulesChanged,
    ops: ops.filter(e => inWindow(e.at)).sort((a, b) => a.at.getTime() - b.at.getTime()),
  };
}
