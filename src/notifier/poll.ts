import { randomUUID } from "node:crypto";
import type { GmailClient } from "../gmail/client.js";
import type { EmailMeta } from "../gmail/headers.js";
import type { MemoryStore } from "../memory/store.js";
import type { LLMProvider } from "../llm/provider.js";
import type { ActionLogRepo } from "../cleanup/proposals.js";
import type { SyncStateRepo, SeenRepo } from "./sync.js";
import { classifyEmail } from "./classify.js";
import { guardVet } from "../cleanup/guard.js";
import { isNotFound } from "../gmail/errors.js";
import { log, logMeta } from "../util/log.js";

export interface DigestItem { messageId: string; from: string; subject: string; reason: string; }

// Per-cycle ceiling on guarded body-reads. A backstop against a flood from one
// guarded sender blowing the 60s poll budget; overflow is kept + surfaced (never
// trashed unread), so the cap can never cause silent loss.
export const GUARDED_POLL_CAP = 20;

export interface PollDeps {
  userId: number; gmail: GmailClient; store: MemoryStore; llm: LLMProvider;
  sync: SyncStateRepo; seen: SeenRepo; actionLog: ActionLogRepo;
  guardedCap?: number; // test seam; defaults to GUARDED_POLL_CAP
}
export interface PollResult {
  firstRun: boolean;
  important: DigestItem[];
  processed: number;
  guardedTrashed: number;
  guardedArchived: number;
  unruled: string[]; // senders left in the inbox that have no rule yet (deduped) — surfaced so the owner can teach one
  commit: () => Promise<void>;
}

export async function runPoll(deps: PollDeps): Promise<PollResult> {
  // Capture the head history id ONCE, before listing, so the cursor we eventually
  // advance to cannot race past messages that arrive mid-poll.
  const headId = await deps.gmail.currentHistoryId();
  const cursor = await deps.sync.get(deps.userId);
  if (cursor === null) {
    await deps.sync.set(deps.userId, headId);
    return { firstRun: true, important: [], processed: 0, guardedTrashed: 0, guardedArchived: 0, unruled: [], commit: async () => {} };
  }
  const ids = await deps.gmail.listAddedMessageIds(cursor);
  const important: DigestItem[] = [];
  const toCommit: { id: string; reason: string }[] = [];
  const actedToCommit: string[] = []; // guarded-acted (trashed/archived) ids: seen-recorded at commit, so the report survives a failed send + retry
  const guardedTrash: EmailMeta[] = [];   // action:"review" — judged, then junk trashed
  const guardedArchive: EmailMeta[] = []; // action:"review_archive" — judged, then routine archived
  const unruledSenders = new Map<string, string>(); // fromEmail → display "from"; senders with no rule, left in inbox
  let processed = 0;
  for (const id of ids) {
    if (await deps.seen.has(deps.userId, id)) continue;
    let email: EmailMeta;
    try {
      email = await deps.gmail.getMeta(id);
    } catch (err) {
      // history.list referenced this message, but it was deleted/removed before we
      // could fetch it → messages.get 404s. Skip it: one dead message must not abort
      // the whole poll, which would leave the cursor un-advanced and re-404 every
      // cycle until it ages out of the history window (a silent, days-long stall).
      if (isNotFound(err)) { log("poll.msg", { userId: deps.userId, id, action: "skipped-gone" }); continue; }
      throw err;
    }
    processed++;
    const rule = deps.store.findRuleFor(email.fromEmail, email.fromDomain);
    if (rule?.action === "review") { guardedTrash.push(email); log("poll.msg", { userId: deps.userId, ...logMeta(email), rule: "review", action: "guarded-queued" }); continue; }
    if (rule?.action === "review_archive") { guardedArchive.push(email); log("poll.msg", { userId: deps.userId, ...logMeta(email), rule: "review_archive", action: "guarded-queued" }); continue; }
    const outcome = await classifyEmail(email, { store: deps.store, llm: deps.llm });
    if (outcome.important) {
      // Defer marking-seen + cursor advance until the brief is delivered.
      important.push({ messageId: id, from: email.from, subject: email.subject, reason: outcome.reason });
      toCommit.push({ id, reason: outcome.reason });
      log("poll.msg", { userId: deps.userId, ...logMeta(email), verdict: "important", source: outcome.source, reason: outcome.reason, action: "surfaced" });
    } else {
      // Not surfaced to the user, so recording now is safe and avoids re-classifying on retry.
      const verdict = outcome.suspicious ? "suspicious" : "unimportant";
      await deps.seen.record(deps.userId, { messageId: id, surfaced: false, verdict, reason: outcome.reason });
      // No rule matched (source "llm") → this is an un-ruled sender left in the inbox; flag it so the owner can teach a rule.
      if (outcome.source === "llm") unruledSenders.set(email.fromEmail, email.from);
      log("poll.msg", { userId: deps.userId, ...logMeta(email), verdict, source: outcome.source, reason: outcome.reason, action: "left" });
    }
  }

  // Guarded batches: read full bodies, ACT on the junk/routine (action-log recorded
  // FIRST so undo always covers it), surface the keepers. review → trash,
  // review_archive → archive. Overflow beyond the cap is kept, never acted unread.
  // Acted ids are seen-recorded at commit time (not here) so that if the brief send
  // fails, the retry re-processes them and re-reports rather than skipping silently.
  // A retry re-acts idempotently (Gmail trash/removeLabel are no-ops if applied).
  let guardedTrashed = 0, guardedArchived = 0;
  const cap = deps.guardedCap ?? GUARDED_POLL_CAP;
  for (const [group, verb] of [[guardedTrash, "trash"], [guardedArchive, "archive"]] as const) {
    if (group.length === 0) continue;
    const g = await guardVet(group.map(m => m.id), { gmail: deps.gmail, llm: deps.llm, cap });
    const metaById = new Map(group.map(m => [m.id, m]));
    if (g.act.length > 0) {
      await deps.actionLog.record(deps.userId, randomUUID(), g.act, verb); // record before mutating so undo always covers it
      if (verb === "trash") await deps.gmail.trash(g.act); else await deps.gmail.archive(g.act);
      actedToCommit.push(...g.act);
      if (verb === "trash") guardedTrashed += g.act.length; else guardedArchived += g.act.length;
      for (const id of g.act) {
        const m = metaById.get(id);
        log("poll.guarded", { userId: deps.userId, ...(m ? logMeta(m) : { id }), action: verb === "trash" ? "trashed" : "archived" });
      }
    }
    for (const k of g.keep) {
      important.push({ messageId: k.id, from: k.from, subject: k.subject, reason: `guarded-kept: ${k.reason}` });
      toCommit.push({ id: k.id, reason: `guarded-kept: ${k.reason}` });
      log("poll.guarded", { userId: deps.userId, id: k.id, from: k.from, subject: k.subject, reason: k.reason, action: "kept" });
    }
    if (g.capped) {
      // Beyond the per-cycle cap: never act unread. Keep + surface for review.
      for (const m of group.slice(cap)) {
        important.push({ messageId: m.id, from: m.from, subject: m.subject, reason: "guarded-overflow: kept for review" });
        toCommit.push({ id: m.id, reason: "guarded-overflow" });
        log("poll.guarded", { userId: deps.userId, ...logMeta(m), action: "overflow-kept" });
      }
    }
  }

  const commit = async (): Promise<void> => {
    for (const c of toCommit) {
      await deps.seen.record(deps.userId, { messageId: c.id, surfaced: true, verdict: "important", reason: c.reason });
    }
    for (const id of actedToCommit) {
      // Recorded only now (after the brief is delivered) so a failed send leaves
      // them un-seen and the retry re-reports the action instead of dropping it.
      await deps.seen.record(deps.userId, { messageId: id, surfaced: false, verdict: "unimportant", reason: "guarded-acted" });
    }
    await deps.sync.set(deps.userId, headId);
  };
  return { firstRun: false, important, processed, guardedTrashed, guardedArchived, unruled: [...unruledSenders.values()], commit };
}
