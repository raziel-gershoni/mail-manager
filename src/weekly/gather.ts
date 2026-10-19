// src/weekly/gather.ts
// The facts the weekly retrospect reports, for one user over its window: what was
// trashed or archived (with id and why), spam rescues and undos, rule changes, and
// operational issues. Read-only.
import type { ActivityRepo, ActedSource } from "../notifier/activity.js";
import type { ActionLogRepo } from "../cleanup/proposals.js";
import type { MemoryStore } from "../memory/store.js";
import type { OpsEvent, OpsEventRepo } from "../ops/events.js";

export interface WeekFacts {
  acted: { messageId?: string; from: string; subject: string; action: "trashed" | "archived"; source?: ActedSource; at: Date }[]; // oldest first
  rescued: number;      // messages rescued from spam in the window
  undone: number;       // runs undone in the window (whenever they ran)
  rulesNew: number;     // rules/preferences created in the window
  rulesChanged: number; // created before the window, updated in it (R4). Hard deletes leave no trace, so they aren't counted.
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

// Where the retrospect's window starts: local midnight RETRO_WINDOW_DAYS days before
// today's local date in `timezone` — the last 7 full local days plus today so far. The
// day arithmetic is on the LOCAL calendar and the result is converted back with that
// night's own UTC offset, so a DST change inside the window can't move it by an hour.
// A bad or empty timezone falls back to UTC.
export function retroSince(now: Date, timezone: string): Date {
  const tz = zoneOrUtc(timezone);
  const { y, m, d } = wallClock(now, tz);
  const midnightAsUtc = Date.UTC(y, m - 1, d - RETRO_WINDOW_DAYS);
  // Two passes: the offset read at the first guess can belong to the other side of a
  // DST change; reading it again at the corrected instant settles it.
  let at = midnightAsUtc - zoneOffsetMs(new Date(midnightAsUtc), tz);
  at = midnightAsUtc - zoneOffsetMs(new Date(at), tz);
  return new Date(at);
}

export async function gatherWeek(deps: {
  userId: number; since: Date; activity: ActivityRepo; actionLog: ActionLogRepo; store: MemoryStore; ops: OpsEventRepo;
}): Promise<WeekFacts> {
  const from = deps.since.getTime();
  const inWindow = (d: Date): boolean => d.getTime() >= from;
  const [activity, runs, ops] = await Promise.all([
    deps.activity.since(deps.userId, deps.since),
    deps.actionLog.runsSince(deps.userId, deps.since),
    deps.ops.since(deps.userId, deps.since),
  ]);
  // The repos already filter by `since`; the window is applied again here so the counts
  // never depend on a repo's exact edge semantics.
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
  const rulesChanged = rows.filter(r => r.createdAt !== undefined && !inWindow(r.createdAt) && r.updatedAt !== undefined && inWindow(r.updatedAt)).length;
  return {
    acted, rescued, undone, rulesNew, rulesChanged,
    ops: ops.filter(e => inWindow(e.at)).sort((a, b) => a.at.getTime() - b.at.getTime()),
  };
}
