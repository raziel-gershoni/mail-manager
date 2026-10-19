// src/weekly/run.ts
// The weekly jobs (spam check, retrospect), run from the hourly poll after that user's
// regular report has been sent and committed. Each job runs on the first polled run of
// each calendar week in the user's timezone, and its week key is written only AFTER its
// report was sent: a job that fails, or never gets time to start, simply runs again at
// the next hour. A job's failure never touches the other job or the hourly poll.
import type { GmailClient } from "../gmail/client.js";
import type { LLMProvider } from "../llm/provider.js";
import type { MemoryStore } from "../memory/store.js";
import type { DigestRef } from "../notifier/refs.js";
import type { Lang } from "../i18n/index.js";
import type { WeeklyKind, WeeklyRunRepo } from "./runs.js";
import { weekKey } from "./week.js";
import { log } from "../util/log.js";

// Both measured from the start of the poll run (runStart = deadline − POLL_LOOP_BUDGET_MS),
// inside Vercel's 300s cap. Sunday's first run is also the week's biggest catch-up, so a
// job only STARTS while there is still room for its work, one slow model call and the
// send; past WEEKLY_START_BY_MS it is skipped with its key unset, and the next hour runs
// it. WEEKLY_DEADLINE_MS is when a running job stops taking on work and reports what it has.
export const WEEKLY_START_BY_MS = 230_000;
export const WEEKLY_DEADLINE_MS = 270_000;

export interface WeeklyDeps {
  userId: number; chatId: number; timezone: string; language: Lang;
  now: () => number; // epoch ms
  runStart: number;  // epoch ms when this poll run started
  gmail: GmailClient; llm: LLMProvider; store: MemoryStore; runs: WeeklyRunRepo;
  send: (text: string, opts: { silent: boolean }) => Promise<number | undefined>; // → the sent Telegram message id
  saveRefs: (messageId: number, refs: DigestRef[]) => Promise<void>;
}

// What a job hands back to be sent: the message, whether it goes out without a sound,
// and the refs that couple the message to exact Gmail ids — in the report's numbered
// order, so a reply "rescue 1 3" resolves to exact messages.
export interface WeeklyReport { text: string; silent: boolean; refs: DigestRef[] }
export type WeeklyRunner = (deps: WeeklyDeps, deadline: number) => Promise<WeeklyReport>;
export interface WeeklyJob { kind: WeeklyKind; run: WeeklyRunner }

// The weekly jobs, in the order they run.
export const WEEKLY_JOBS: readonly WeeklyJob[] = [];

export async function runWeeklyJobs(deps: WeeklyDeps, jobs: readonly WeeklyJob[]): Promise<void> {
  const startBy = deps.runStart + WEEKLY_START_BY_MS;
  const deadline = deps.runStart + WEEKLY_DEADLINE_MS;
  const week = weekKey(new Date(deps.now()), deps.timezone);
  for (const job of jobs) {
    const fields = { userId: deps.userId, kind: job.kind, week };
    if (deps.now() >= startBy) {
      log("weekly.skipped", { ...fields, reason: "no-time" }); // key stays unset: the next hour runs it
      continue;
    }
    try {
      if (await deps.runs.get(deps.userId, job.kind) === week) continue; // already reported this week
      const report = await job.run(deps, deadline);
      const sentId = await deps.send(report.text, { silent: report.silent });
      // The refs are what make a reply resolve to exact ids, but the report is already
      // delivered: a failure here is logged, and the week still counts as done (a missing
      // ref makes the agent ask, never guess).
      if (typeof sentId === "number" && report.refs.length > 0) {
        try { await deps.saveRefs(sentId, report.refs); }
        catch (err) { log("weekly.refs_failed", { ...fields, error: err instanceof Error ? err.message : String(err) }); }
      }
      // Only now, with the report delivered: a key is never set without a sent report.
      await deps.runs.set(deps.userId, job.kind, week);
      log("weekly.sent", { ...fields, silent: report.silent, refs: report.refs.length });
    } catch (err) {
      log("weekly.failed", { ...fields, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

// Called by the poll route for each polled user. Never throws.
export async function runWeeklyTasks(deps: WeeklyDeps): Promise<void> {
  await runWeeklyJobs(deps, WEEKLY_JOBS);
}
