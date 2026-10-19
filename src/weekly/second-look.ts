// src/weekly/second-look.ts
// The weekly retrospect's second look: re-read what the bot trashed or archived this week
// (messages in Trash stay readable by id) and ask the model whether any of it was
// plausibly a mistake. Read-only: it only reports; the owner decides what to restore.
import type { GmailClient } from "../gmail/client.js";
import { GMAIL_FETCH_CONCURRENCY } from "../gmail/client.js";
import type { EmailMeta } from "../gmail/headers.js";
import { isNotFound } from "../gmail/errors.js";
import { attachmentLine } from "../gmail/parts.js";
import type { LLMProvider, ActedCandidate } from "../llm/provider.js";
import type { ActedSource } from "../notifier/activity.js";
import { mapLimit } from "../util/concurrency.js";
import { log } from "../util/log.js";
import type { WeekFacts } from "./gather.js";

export const SECOND_LOOK_CAP = 300;  // messages re-checked per week; the rest are reported as not re-checked
export const SECOND_LOOK_BATCH = 40; // messages per reviewActed call

export interface SecondLook {
  flagged: { id: string; from: string; subject: string; action: "trashed" | "archived"; reason: string }[]; // newest first
  unjudged: number;    // re-checked but not judged: a fetch or review failed, the model gave no usable verdict, or time ran out
  skippedGone: number; // deleted for good since (Gmail 404)
  capped: boolean;     // more than SECOND_LOOK_CAP were checkable
  incomplete: boolean; // the deadline stopped it early
}

// What made the bot act, in words the model can weigh.
const WHY: Record<ActedSource, string> = {
  plain: "a sender rule (acted on without reading the body)",
  guarded: "a guarded sender rule (body read and judged first)",
  pref: "a standing preference (body read and judged first)",
  chat: "the owner asked in chat",
};

// The acted messages the second look can re-check: those with a Gmail id (rows logged
// before migration 0018 have none), each once with its latest action, newest first — so
// the cap keeps the freshest.
export function checkableActed(facts: WeekFacts): { id: string; action: "trashed" | "archived"; source?: ActedSource }[] {
  const seen = new Set<string>();
  const out: { id: string; action: "trashed" | "archived"; source?: ActedSource }[] = [];
  for (let i = facts.acted.length - 1; i >= 0; i--) {
    const a = facts.acted[i]!;
    if (!a.messageId || seen.has(a.messageId)) continue;
    seen.add(a.messageId);
    out.push({ id: a.messageId, action: a.action, ...(a.source ? { source: a.source } : {}) });
  }
  return out;
}

const TIMED_OUT = Symbol("timed-out");
const MAX_TIMER_MS = 2_147_483_647; // setTimeout fires at once past this

// Stop WAITING for a model call once the deadline passes (same pattern as B2's checkSpam,
// whose helper is module-private): a Gemini call can take its whole 40s HTTP timeout, and
// the report must still be sent before Vercel's 300s cap. The abandoned call keeps
// running; its late settlement is swallowed.
async function beforeDeadline<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  p.catch(() => {});
  try {
    return await Promise.race([p, new Promise<typeof TIMED_OUT>(r => { timer = setTimeout(() => r(TIMED_OUT), Math.min(Math.max(0, ms), MAX_TIMER_MS)); })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function secondLook(
  facts: WeekFacts,
  deps: { gmail: GmailClient; llm: LLMProvider; deadline: number; now: () => number },
): Promise<SecondLook> {
  const all = checkableActed(facts);
  const items = all.slice(0, SECOND_LOOK_CAP);
  const state = { unjudged: 0, skippedGone: 0, incomplete: false };

  // One fetch per message, each isolated: mapLimit stops at the first rejection, so one
  // bad message must never sink the whole look. A 404 means deleted for good since —
  // skipped and counted. Past the deadline nothing more is fetched.
  const metas = await mapLimit(items, GMAIL_FETCH_CONCURRENCY, async (it): Promise<EmailMeta | null> => {
    if (deps.now() >= deps.deadline) { state.incomplete = true; state.unjudged++; return null; }
    try {
      return await deps.gmail.getMeta(it.id);
    } catch (err) {
      if (isNotFound(err)) { state.skippedGone++; return null; }
      state.unjudged++;
      log("weekly.retro_fetch_failed", { id: it.id, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  });

  const candidates: ActedCandidate[] = [];
  items.forEach((it, i) => {
    const m = metas[i];
    if (!m) return;
    // Already back (the owner restored it, or undid the action): nothing to flag. A trashed
    // message is back once it no longer carries TRASH: mail trashed by adding the TRASH
    // label keeps its INBOX label while in Trash, so INBOX alone proves nothing. An
    // archived one is back once it carries INBOX again (and isn't in Trash).
    const inTrash = m.labelIds.includes("TRASH");
    if (it.action === "trashed" ? !inTrash : (!inTrash && m.labelIds.includes("INBOX"))) return;
    const line = attachmentLine(m.attachments);
    candidates.push({ id: it.id, from: m.from, subject: m.subject, snippet: m.snippet, action: it.action,
      why: it.source ? WHY[it.source] : "not recorded", ...(line ? { attachmentLine: line } : {}) });
  });

  // Judge in batches. A batch's unjudged count is worked out here from the verdicts that
  // came back for ITS ids, so a sloppy model (or provider) can't inflate or hide it. Each
  // call is raced against the deadline: a batch started just before it must not carry the
  // run past Vercel's 300s cap, where the report would never be sent.
  const reasons = new Map<string, string>();
  for (let i = 0; i < candidates.length; i += SECOND_LOOK_BATCH) {
    const batch = candidates.slice(i, i + SECOND_LOOK_BATCH);
    if (deps.now() >= deps.deadline) { state.incomplete = true; state.unjudged += candidates.length - i; break; }
    try {
      const r = await beforeDeadline(deps.llm.reviewActed(batch), deps.deadline - deps.now());
      if (r === TIMED_OUT) { state.incomplete = true; state.unjudged += candidates.length - i; break; }
      const ids = new Set(batch.map(c => c.id));
      const judged = new Set<string>();
      for (const v of r.verdicts) {
        if (!ids.has(v.id) || judged.has(v.id)) continue;
        judged.add(v.id);
        if (v.looksWrong) reasons.set(v.id, v.reason);
      }
      state.unjudged += batch.length - judged.size;
    } catch (err) {
      state.unjudged += batch.length;
      log("weekly.retro_review_failed", { n: batch.length, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const flagged = candidates.filter(c => reasons.has(c.id))
    .map(c => ({ id: c.id, from: c.from, subject: c.subject, action: c.action, reason: reasons.get(c.id)! }));
  return { flagged, unjudged: state.unjudged, skippedGone: state.skippedGone, capped: all.length > SECOND_LOOK_CAP, incomplete: state.incomplete };
}
