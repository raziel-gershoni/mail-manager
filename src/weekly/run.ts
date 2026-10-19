// src/weekly/run.ts
// The weekly jobs (spam check, retrospect), run from the hourly poll after that user's
// regular report has been sent and committed. Each job runs on the first polled run of
// each calendar week in the user's timezone, and its week key is written only AFTER its
// report was sent: a job that fails, or never gets time to start, simply runs again at
// the next hour. A job's failure never touches the other job or the hourly poll.
// A job that keeps failing is capped: each failure is a "weekly_failed" ops event, and
// once a kind has failed WEEKLY_MAX_ATTEMPTS times this week the owner gets a short
// notice instead and the week is closed — the scan isn't re-run every hour all week.
import type { GmailClient } from "../gmail/client.js";
import type { LLMProvider } from "../llm/provider.js";
import type { MemoryStore } from "../memory/store.js";
import type { DigestRef } from "../notifier/refs.js";
import { t, type Lang, type MsgKey } from "../i18n/index.js";
import type { WeeklyKind, WeeklyRunRepo } from "./runs.js";
import { weekKey } from "./week.js";
import { checkSpam } from "./spam.js";
import { composeSpamReport } from "./spam-report.js";
import { retroReport } from "./retro.js";
import type { ActivityRepo } from "../notifier/activity.js";
import type { ActionLogRepo } from "../cleanup/proposals.js";
import { recordOpsEvent, type OpsEventRepo } from "../ops/events.js";
import { retroUntil } from "./gather.js";
import { log } from "../util/log.js";

// Both measured from the start of the poll run (runStart = deadline − POLL_LOOP_BUDGET_MS),
// inside Vercel's 300s cap. Sunday's first run is also the week's biggest catch-up, so a
// job only STARTS while there is still room for its work, one slow model call and the
// send; past WEEKLY_START_BY_MS it is skipped with its key unset, and the next hour runs
// it. WEEKLY_DEADLINE_MS is when a running job stops taking on work and reports what it has.
export const WEEKLY_START_BY_MS = 230_000;
export const WEEKLY_DEADLINE_MS = 270_000;
// Failed runs of one kind in one week (job or send threw) before it gives up on that week.
export const WEEKLY_MAX_ATTEMPTS = 3;

export interface WeeklyDeps {
  userId: number; chatId: number; timezone: string; language: Lang;
  now: () => number; // epoch ms
  runStart: number;  // epoch ms when this poll run started
  gmail: GmailClient; llm: LLMProvider; store: MemoryStore; runs: WeeklyRunRepo;
  send: (text: string, opts: { silent: boolean }) => Promise<number | undefined>; // → the sent Telegram message id
  saveRefs: (messageId: number, refs: DigestRef[]) => Promise<void>;
  // The retrospect's sources. Optional so the spam kind and its tests (tests/weekly/run.test.ts,
  // tests/weekly/run.spam.test.ts) don't need them; the retro kind throws without them
  // (logged as weekly.failed, week left unmarked). The poll route always passes all three.
  // `ops` also carries the attempt cap: without it, a failing job retries every hour.
  activity?: ActivityRepo;
  actionLog?: ActionLogRepo;
  ops?: OpsEventRepo;
}

// What a job hands back to be sent: the message, whether it goes out without a sound,
// and the refs that couple the message to exact Gmail ids — in the report's numbered
// order, so a reply "rescue 1 3" resolves to exact messages.
export interface WeeklyReport { text: string; silent: boolean; refs: DigestRef[] }
export type WeeklyRunner = (deps: WeeklyDeps, deadline: number) => Promise<WeeklyReport>;
export interface WeeklyJob { kind: WeeklyKind; run: WeeklyRunner }

// The spam check: judge last week's Spam, then report what looks legitimate.
async function spamJob(deps: WeeklyDeps, deadline: number): Promise<WeeklyReport> {
  const check = await checkSpam({ gmail: deps.gmail, llm: deps.llm, store: deps.store, deadline, now: deps.now });
  log("weekly.spam", { userId: deps.userId, total: check.total, flagged: check.flagged.length, unjudged: check.unjudged, capped: check.capped, incomplete: check.incomplete });
  return composeSpamReport(check, deps.language);
}

// The weekly jobs, in the order they run.
export const WEEKLY_JOBS: readonly WeeklyJob[] = [
  { kind: "spam", run: spamJob },
  { kind: "retro", run: retroReport }, // after the spam check (spec C §1)
];

const errText = (err: unknown): string => err instanceof Error ? err.message : String(err);

// The notice sent instead of a report the week gave up on. Trusted text only: nothing
// from the mail, the model or the error goes into it.
const GAVE_UP: Record<WeeklyKind, MsgKey> = { spam: "weekly_gave_up_spam", retro: "weekly_gave_up_retro" };

// How many times `kind` already failed this week, from the ops events since this week's
// Sunday (local midnight). Filtering on the event's own week makes the count exact. With
// no ops repo, or one that can't be read, it is 0: the job runs, as it always did.
async function failedAttempts(deps: WeeklyDeps, kind: WeeklyKind, week: string): Promise<number> {
  if (!deps.ops) return 0;
  try {
    const events = await deps.ops.since(deps.userId, retroUntil(new Date(deps.now()), deps.timezone));
    return events.filter(e => e.kind === "weekly_failed" && e.detail?.kind === kind && e.detail?.week === week).length;
  } catch (err) {
    log("weekly.attempts_unreadable", { userId: deps.userId, kind, week, error: errText(err) });
    return 0;
  }
}

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
      if (await failedAttempts(deps, job.kind, week) >= WEEKLY_MAX_ATTEMPTS) {
        // Give this week up: tell the owner, then close the week. If even this send fails,
        // the key stays unset and the next hour sends the notice again (not an attempt).
        await deps.send(t(deps.language, GAVE_UP[job.kind]), { silent: false });
        await deps.runs.set(deps.userId, job.kind, week);
        log("weekly.gave_up", { ...fields, attempts: WEEKLY_MAX_ATTEMPTS });
        continue;
      }
      let report: WeeklyReport;
      let sentId: number | undefined;
      try {
        report = await job.run(deps, deadline);
        sentId = await deps.send(report.text, { silent: report.silent });
      } catch (err) {
        // One attempt used. recordOpsEvent never throws, so the failure is still logged below.
        if (deps.ops) await recordOpsEvent(deps.ops, deps.userId, "weekly_failed", { kind: job.kind, week, error: errText(err).slice(0, 300) });
        throw err;
      }
      // The refs are what make a reply resolve to exact ids, but the report is already
      // delivered: a failure here is logged, and the week still counts as done (a missing
      // ref makes the agent ask, never guess).
      if (typeof sentId === "number" && report.refs.length > 0) {
        try { await deps.saveRefs(sentId, report.refs); }
        catch (err) { log("weekly.refs_failed", { ...fields, error: errText(err) }); }
      }
      // Only now, with the report delivered: a key is never set without a sent report.
      await deps.runs.set(deps.userId, job.kind, week);
      log("weekly.sent", { ...fields, silent: report.silent, refs: report.refs.length });
    } catch (err) {
      log("weekly.failed", { ...fields, error: errText(err) });
    }
  }
}

// Called by the poll route for each polled user. Never throws.
export async function runWeeklyTasks(deps: WeeklyDeps): Promise<void> {
  await runWeeklyJobs(deps, WEEKLY_JOBS);
}
