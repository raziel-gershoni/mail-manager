import type { GmailClient } from "../gmail/client.js";
import type { LLMProvider } from "../llm/provider.js";
import type { GuardKeep, GuardResult } from "./guard.js";
import { readCandidates } from "./read-candidates.js";

// Per-verb ceiling on body reads for preference-driven acting. Deliberately lower
// than GUARDED_POLL_CAP (20): the sender-guarded path already spends that cap PER VERB,
// so two more queues at 20 would push a 60s function to 80 reads + 4 review calls, on
// top of the one classify call the poll already makes per un-ruled message. Overflow
// is kept, so this cap can never cause loss.
export const PREF_POLL_CAP = 10;

// Judgment for preference-driven acting: read each FULL body and ask whether the
// owner's standing preference genuinely applies, keeping on any uncertainty.
//
// This shares readCandidates' read/build preamble with guardVet (src/cleanup/
// read-candidates.ts) — that part is pure setup with no verdict logic — but
// deliberately does NOT reuse vetTrashSet for the verdict itself: that function
// sets aside every non-bulk candidate WITHOUT consulting the LLM
// (src/cleanup/vet.ts:15), which is the right heuristic for sweeping generic
// junk and the wrong one for an explicit topic instruction — a non-bulk crypto
// pitch would be silently rescued and the owner's preference would never fire.
export async function preferenceVet(
  ids: string[],
  deps: { gmail: GmailClient; llm: LLMProvider; cap: number; preference: string },
): Promise<GuardResult> {
  const { candidates, capped } = await readCandidates(ids, deps);
  if (candidates.length === 0) return { act: [], keep: [], capped };
  const verdicts = await deps.llm.reviewPreference(candidates, deps.preference);
  const byId = new Map(verdicts.map(v => [v.id, v]));
  const act: string[] = [];
  const keep: GuardKeep[] = [];
  for (const c of candidates) {
    // Keep-on-uncertainty: only an explicit keep === false results in acting.
    // Anything malformed, missing, or ambiguous (absent verdict, non-boolean
    // keep, etc.) keeps — the safe error is a false keep, never a false trash.
    const v = byId.get(c.id);
    if (!v || v.keep !== false) keep.push({ id: c.id, from: c.from, subject: c.subject, reason: v?.reason ?? "unjudged-rescue" });
    else act.push(c.id);
  }
  return { act, keep, capped };
}
