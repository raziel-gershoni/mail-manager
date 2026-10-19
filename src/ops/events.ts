// src/ops/events.ts
// Operational issues the owner should hear about in the weekly retrospect: a catch-up
// that didn't finish in one run, an expired Gmail cursor, a dead Google token, a failed
// hourly poll, a chat turn that failed for good, a weekly report that failed (it is
// retried the next hour, at most WEEKLY_MAX_ATTEMPTS times a week — src/weekly/run.ts
// counts these events). Until now these were console logs only.
// They are written through recordOpsEvent, which NEVER throws: recording an event must
// never break the path it observes. Kept for 30 days (the retrospect prunes).
import { log } from "../util/log.js";

export type OpsEventKind = "poll_incomplete" | "cursor_expired" | "reconnect_needed" | "poll_errored" | "worker_failed" | "weekly_failed";
export interface OpsEvent { kind: OpsEventKind; at: Date; detail: Record<string, unknown> | null }
export interface OpsEventRepo {
  record(userId: number, kind: OpsEventKind, detail?: Record<string, unknown>): Promise<void>;
  since(userId: number, since: Date): Promise<OpsEvent[]>; // at >= since, oldest first
  prune(before: Date): Promise<void>;                       // every user's events with at < before
}

export const OPS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function recordOpsEvent(repo: OpsEventRepo, userId: number, kind: OpsEventKind, detail?: Record<string, unknown>): Promise<void> {
  try {
    await repo.record(userId, kind, detail);
  } catch (err) {
    log("ops.record_failed", { userId, kind, error: err instanceof Error ? err.message : String(err) });
  }
}

// The two poll facts worth an event, read off a finished runPoll: a catch-up that ran out
// of time (remaining > 0) and an expired history cursor. The poll route records them, so
// runPoll itself stays free of the ops repo.
export function pollOutcomeEvents(res: { processed: number; remaining: number; cursorExpired: boolean }): { kind: OpsEventKind; detail?: Record<string, unknown> }[] {
  const out: { kind: OpsEventKind; detail?: Record<string, unknown> }[] = [];
  if (res.cursorExpired) out.push({ kind: "cursor_expired" });
  if (res.remaining > 0) out.push({ kind: "poll_incomplete", detail: { processed: res.processed, remaining: res.remaining } });
  return out;
}

export async function recordPollOutcome(repo: OpsEventRepo, userId: number, res: { processed: number; remaining: number; cursorExpired: boolean }): Promise<void> {
  for (const e of pollOutcomeEvents(res)) await recordOpsEvent(repo, userId, e.kind, e.detail);
}

// `clock` stamps each event (a test seam for the date window and pruning).
export function fakeOpsEventRepo(clock: () => Date = () => new Date()): OpsEventRepo & { all(userId: number): OpsEvent[] } {
  let rows: { userId: number; event: OpsEvent; seq: number }[] = [];
  let seq = 0;
  const ordered = (userId: number) => rows.filter(r => r.userId === userId)
    .sort((a, b) => a.event.at.getTime() - b.event.at.getTime() || a.seq - b.seq)
    .map(r => ({ ...r.event }));
  return {
    async record(userId, kind, detail) { rows.push({ userId, event: { kind, at: clock(), detail: detail ?? null }, seq: seq++ }); },
    async since(userId, since) { return ordered(userId).filter(e => e.at.getTime() >= since.getTime()); },
    async prune(before) { rows = rows.filter(r => r.event.at.getTime() >= before.getTime()); },
    all(userId) { return ordered(userId); },
  };
}
