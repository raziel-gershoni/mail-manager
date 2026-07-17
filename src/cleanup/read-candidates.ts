import type { GmailClient } from "../gmail/client.js";
import { GMAIL_FETCH_CONCURRENCY } from "../gmail/client.js";
import type { EmailMeta } from "../gmail/headers.js";
import type { TrashCandidate } from "../llm/provider.js";
import { riskSignals } from "../gmail/risk.js";
import { mapLimit } from "../util/concurrency.js";

// Shared read/build preamble for guardVet and preferenceVet: caps the id list,
// reads each FULL body, and builds TrashCandidate rows via riskSignals. This is
// pure read/setup — it carries no verdict logic, so sharing it cannot leak
// either vet's judgment into the other. `capped` reports overflow so the
// caller can defer it (nothing is ever acted on unread).
export async function readCandidates(
  ids: string[],
  deps: { gmail: GmailClient; cap: number },
): Promise<{ candidates: TrashCandidate[]; metas: Map<string, EmailMeta>; capped: boolean }> {
  const capped = ids.length > deps.cap;
  const use = ids.slice(0, deps.cap);
  if (use.length === 0) return { candidates: [], metas: new Map(), capped };
  const fulls = await mapLimit(use, GMAIL_FETCH_CONCURRENCY, (id) => deps.gmail.readFull(id));
  const candidates: TrashCandidate[] = fulls.map(f => {
    const r = riskSignals(f.meta);
    return { id: f.meta.id, from: f.meta.from, subject: f.meta.subject, bulk: r.bulk, transactional: r.transactional, bodyText: f.bodyText };
  });
  const metas = new Map(fulls.map(f => [f.meta.id, f.meta]));
  return { candidates, metas, capped };
}
