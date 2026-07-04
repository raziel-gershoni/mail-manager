import { randomUUID } from "node:crypto";
import type { GmailClient } from "../gmail/client.js";
import type { EmailMeta } from "../gmail/headers.js";
import type { MemoryStore } from "../memory/store.js";
import type { LLMProvider } from "../llm/provider.js";
import type { ActionLogRepo } from "../cleanup/proposals.js";
import type { SyncStateRepo, SeenRepo } from "./sync.js";
import { classifyEmail } from "./classify.js";
import { guardVet } from "../cleanup/guard.js";

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
  commit: () => Promise<void>;
}

export async function runPoll(deps: PollDeps): Promise<PollResult> {
  // Capture the head history id ONCE, before listing, so the cursor we eventually
  // advance to cannot race past messages that arrive mid-poll.
  const headId = await deps.gmail.currentHistoryId();
  const cursor = await deps.sync.get(deps.userId);
  if (cursor === null) {
    await deps.sync.set(deps.userId, headId);
    return { firstRun: true, important: [], processed: 0, guardedTrashed: 0, commit: async () => {} };
  }
  const ids = await deps.gmail.listAddedMessageIds(cursor);
  const important: DigestItem[] = [];
  const toCommit: { id: string; reason: string }[] = [];
  const guardedMetas: EmailMeta[] = []; // messages from a guarded (action:"review") sender
  let processed = 0;
  for (const id of ids) {
    if (await deps.seen.has(deps.userId, id)) continue;
    processed++;
    const email = await deps.gmail.getMeta(id);
    const rule = deps.store.findRuleFor(email.fromEmail, email.fromDomain);
    if (rule?.action === "review") { guardedMetas.push(email); continue; } // judged in a batch below
    const outcome = await classifyEmail(email, { store: deps.store, llm: deps.llm });
    if (outcome.important) {
      // Defer marking-seen + cursor advance until the brief is delivered.
      important.push({ messageId: id, from: email.from, subject: email.subject, reason: outcome.reason });
      toCommit.push({ id, reason: outcome.reason });
    } else {
      // Not surfaced to the user, so recording now is safe and avoids re-classifying on retry.
      const verdict = outcome.suspicious ? "suspicious" : "unimportant";
      await deps.seen.record(deps.userId, { messageId: id, surfaced: false, verdict, reason: outcome.reason });
    }
  }

  // Guarded batch: read full bodies, trash the junk (logged first, seen immediately
  // so a retry skips them), surface the keepers. Overflow beyond the cap is kept.
  let guardedTrashed = 0;
  const cap = deps.guardedCap ?? GUARDED_POLL_CAP;
  if (guardedMetas.length > 0) {
    const g = await guardVet(guardedMetas.map(m => m.id), { gmail: deps.gmail, llm: deps.llm, cap });
    if (g.trash.length > 0) {
      await deps.actionLog.record(deps.userId, randomUUID(), g.trash, "trash"); // record before mutating so undo always covers it
      await deps.gmail.trash(g.trash);
      for (const id of g.trash) {
        await deps.seen.record(deps.userId, { messageId: id, surfaced: false, verdict: "unimportant", reason: "guarded-trash" });
      }
      guardedTrashed = g.trash.length;
    }
    for (const k of g.keep) {
      important.push({ messageId: k.id, from: k.from, subject: k.subject, reason: `guarded-kept: ${k.reason}` });
      toCommit.push({ id: k.id, reason: `guarded-kept: ${k.reason}` });
    }
    if (g.capped) {
      // Beyond the per-cycle cap: never trash unread. Keep + surface for review.
      for (const m of guardedMetas.slice(cap)) {
        important.push({ messageId: m.id, from: m.from, subject: m.subject, reason: "guarded-overflow: kept for review" });
        toCommit.push({ id: m.id, reason: "guarded-overflow" });
      }
    }
  }

  const commit = async (): Promise<void> => {
    for (const c of toCommit) {
      await deps.seen.record(deps.userId, { messageId: c.id, surfaced: true, verdict: "important", reason: c.reason });
    }
    await deps.sync.set(deps.userId, headId);
  };
  return { firstRun: false, important, processed, guardedTrashed, commit };
}
