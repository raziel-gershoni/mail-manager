import type { GmailClient } from "../gmail/client.js";
import type { LLMProvider } from "../llm/provider.js";
import { vetTrashSet } from "./vet.js";
import { readCandidates } from "./read-candidates.js";

export interface GuardKeep { id: string; from: string; subject: string; reason: string; }
// `act` = the ids to act on (the caller trashes OR archives them, per the rule);
// `keep` = the ids to keep in the inbox and surface.
export interface GuardResult { act: string[]; keep: GuardKeep[]; capped: boolean; }

// Pure judgment for guarded-trash senders: read each message's FULL body, judge
// keep-vs-trash (biased toward keep — non-bulk and transactional are kept without
// the LLM; the rest are body-reviewed with a keep-on-uncertainty default), and
// return what to trash and what to keep. Does NOT mutate, log, or surface —
// callers (poll loop, apply_action_rules) own those side effects. `cap` bounds
// the number of body reads per call; overflow is reported via `capped` so the
// caller can defer it (nothing is trashed unread).
export async function guardVet(
  ids: string[],
  deps: { gmail: GmailClient; llm: LLMProvider; cap: number },
): Promise<GuardResult> {
  const { candidates, metas, capped } = await readCandidates(ids, deps);
  if (candidates.length === 0) return { act: [], keep: [], capped };
  const vet = await vetTrashSet(candidates, { llm: deps.llm }); // ids already capped above
  const keep: GuardKeep[] = vet.setAside.map(s => {
    const m = metas.get(s.id);
    return { id: s.id, from: m?.from ?? "", subject: m?.subject ?? "", reason: s.reason };
  });
  return { act: vet.autoTrash, keep, capped };
}
