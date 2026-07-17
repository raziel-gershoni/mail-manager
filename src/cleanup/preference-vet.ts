import type { GmailClient } from "../gmail/client.js";
import type { LLMProvider } from "../llm/provider.js";
import type { GuardKeep, GuardResult } from "./guard.js";
import { readCandidates } from "./read-candidates.js";

// Two independent per-verb ceilings bound the preference path's cost per poll cycle.
// Both are enforced by runPoll (src/notifier/poll.ts), which walks the text-keyed
// prefTrash/prefArchive groups for a verb with one running read budget and one group
// counter. Neither can cause loss: whatever either cap excludes is kept in the inbox
// and surfaced as overflow, never acted unread.
//
// PREF_POLL_CAP — body READS per verb, a BUDGET SHARED ACROSS EVERY DISTINCT
// CONFIRMED PREFERENCE matched for that verb, not a fresh allowance per preference
// (the budget is decremented by exactly how many ids each group's preferenceVet call
// actually read).
//
// PREF_GROUP_CAP — preference GROUPS vetted per verb, i.e. reviewPreference CALLS per
// verb. The read budget alone does NOT bound calls usefully: a group costs at least one
// read, so N matched preferences meant up to PREF_POLL_CAP (10) calls per verb — ~20
// serial Gemini calls per user per cycle, each with a 40s HTTP timeout, inside a 60s
// maxDuration function that also iterates users sequentially. Capping groups pins that.
//
// WORST CASE PER USER PER CYCLE, added by the preference path:
//   reads: PREF_POLL_CAP x 2 verbs                = 20 body reads
//   calls: PREF_GROUP_CAP x 2 verbs               = 6 reviewPreference calls
// regardless of how many of the up to PREF_MAX (20, memory/preferences.ts) confirmed
// preferences matched. Realistically 1-2 preferences match per cycle, so PREF_GROUP_CAP
// should almost never bind. This sits on top of what the poll already spends: the
// sender-guarded path's 40 reads + 2 reviewTrash calls (GUARDED_POLL_CAP = 20 per verb,
// one call per verb), plus one classify call per un-ruled message.
//
// This cap is a real ~3x cut (up to 20 → up to 6 reviewPreference calls) versus what an
// uncapped-by-groups preference path could cost, but it does NOT guarantee a poll cycle
// fits app/api/poll/route.ts's maxDuration = 60. True worst case for one user is 8
// SERIAL Gemini calls (this path's 6 reviewPreference + the guarded path's 2
// reviewTrash), each with its own GEMINI_TIMEOUT_MS = 40_000ms HTTP timeout
// (llm/gemini.ts) — 8 x 40s alone exceeds the 60s budget, and pollAllUsers
// (notifier/fanout.ts) polls every user SERIALLY within that one invocation, so a
// second user's poll adds to the same clock. The failure mode is safe, not silent: a
// timeout throws mid-poll, so runPoll's commit() for the in-flight user never runs —
// that user's sync cursor stays unadvanced and the next cycle simply retries; nothing
// already acted on is lost (actionLog.record happens before any mutation) and nothing
// is dropped.
//
// PREF_POLL_CAP is deliberately lower than GUARDED_POLL_CAP (20) for that reason — the
// guarded path already spends its cap per verb, and these queues are additive.
export const PREF_POLL_CAP = 10;
export const PREF_GROUP_CAP = 3;

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
