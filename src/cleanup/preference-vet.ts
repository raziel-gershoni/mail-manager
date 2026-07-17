import type { GmailClient } from "../gmail/client.js";
import { GMAIL_FETCH_CONCURRENCY } from "../gmail/client.js";
import type { LLMProvider, TrashCandidate } from "../llm/provider.js";
import { riskSignals } from "../gmail/risk.js";
import type { GuardKeep, GuardResult } from "./guard.js";
import { mapLimit } from "../util/concurrency.js";

// Per-verb ceiling on body reads for preference-driven acting. Deliberately lower
// than GUARDED_POLL_CAP (20): the sender-guarded path already spends that cap PER VERB,
// so two more queues at 20 would push a 60s function to 80 reads + 4 review calls, on
// top of the one classify call the poll already makes per un-ruled message. Overflow
// is kept, so this cap can never cause loss.
export const PREF_POLL_CAP = 10;

// Judgment for preference-driven acting: read each FULL body and ask whether the
// owner's standing preference genuinely applies, keeping on any uncertainty.
//
// This deliberately does NOT reuse vetTrashSet: that function sets aside every
// non-bulk candidate WITHOUT consulting the LLM (src/cleanup/vet.ts:15), which is the
// right heuristic for sweeping generic junk and the wrong one for an explicit topic
// instruction — a non-bulk crypto pitch would be silently rescued and the owner's
// preference would never fire.
export async function preferenceVet(
  ids: string[],
  deps: { gmail: GmailClient; llm: LLMProvider; cap: number; preference: string },
): Promise<GuardResult> {
  const capped = ids.length > deps.cap;
  const use = ids.slice(0, deps.cap);
  if (use.length === 0) return { act: [], keep: [], capped };
  const fulls = await mapLimit(use, GMAIL_FETCH_CONCURRENCY, (id) => deps.gmail.readFull(id));
  const candidates: TrashCandidate[] = fulls.map(f => {
    const r = riskSignals(f.meta);
    return { id: f.meta.id, from: f.meta.from, subject: f.meta.subject, bulk: r.bulk, transactional: r.transactional, bodyText: f.bodyText };
  });
  const verdicts = await deps.llm.reviewPreference(candidates, deps.preference);
  const byId = new Map(verdicts.map(v => [v.id, v]));
  const act: string[] = [];
  const keep: GuardKeep[] = [];
  for (const c of candidates) {
    // Absent verdict ⇒ keep. parseReviewJson already rescues unjudged ids, but a
    // provider that returns a short array must never cause a silent trash.
    const v = byId.get(c.id);
    if (!v || v.keep) keep.push({ id: c.id, from: c.from, subject: c.subject, reason: v?.reason ?? "unjudged-rescue" });
    else act.push(c.id);
  }
  return { act, keep, capped };
}
