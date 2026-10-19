// src/weekly/spam.ts
// The weekly spam check: list last week's Spam, flag what looks like real mail, and hand
// that to the report. Read-only: nothing here moves mail — only the owner's "rescue"
// (the rescue_from_spam tool) ever takes anything out of Spam.
import type { GmailClient } from "../gmail/client.js";
import { GMAIL_FETCH_CONCURRENCY } from "../gmail/client.js";
import type { EmailMeta } from "../gmail/headers.js";
import { isNotFound } from "../gmail/errors.js";
import { riskSignals } from "../gmail/risk.js";
import { attachmentLine } from "../gmail/parts.js";
import type { LLMProvider, SpamCandidate, SpamVerdict } from "../llm/provider.js";
import type { MemoryStore } from "../memory/store.js";
import { mapLimit } from "../util/concurrency.js";
import { beforeDeadline, TIMED_OUT } from "../util/deadline.js";
import { log } from "../util/log.js";

export const SPAM_SCAN_CAP = 300; // a week of spam; past this the report says it checked the newest 300
export const SPAM_BATCH = 40;     // emails per reviewSpam call

export interface FlaggedSpam { id: string; from: string; subject: string; reason: string; suspicious: boolean; byRule: boolean }
// judged: messages the model gave a usable verdict for; unjudged: messages that couldn't be
// judged (a failed read, a failed batch, a missing or malformed verdict). What the deadline
// cut off is neither — `incomplete` says so.
export interface SpamCheck { total: number; flagged: FlaggedSpam[]; judged: number; unjudged: number; capped: boolean; incomplete: boolean }

const errText = (err: unknown) => err instanceof Error ? err.message : String(err);

// THROWS when there was something to judge but nothing could be: no message could be read,
// or no model batch call came back (each rejected, or was cut by the deadline). A Gemini
// or Gmail outage must fail the job — its key stays unset and the next hour retries
// (bounded by WEEKLY_MAX_ATTEMPTS) — never pass as "nothing looks legitimate" (spec B §1).
// A partial result is still reported, with what it couldn't judge.
export async function checkSpam(deps: { gmail: GmailClient; llm: LLMProvider; store: MemoryStore; deadline: number; now: () => number }): Promise<SpamCheck> {
  // Ask for one more than the cap: getting it back is how we know there were more.
  const listed = await deps.gmail.listSpam(SPAM_SCAN_CAP + 1);
  const capped = listed.length > SPAM_SCAN_CAP;
  const ids = listed.slice(0, SPAM_SCAN_CAP);
  let incomplete = false;
  let unjudged = 0;

  // Read each one's metadata (with its attachment names). Every read has its own
  // try/catch, because mapLimit stops at the first rejection: a message that won't load
  // is "couldn't judge"; one that is gone (404 — rescued or deleted since the listing) is
  // simply skipped. Past the deadline, the rest are left unread and the check is incomplete.
  const metas = await mapLimit(ids, GMAIL_FETCH_CONCURRENCY, async (id): Promise<EmailMeta | null> => {
    if (deps.now() >= deps.deadline) { incomplete = true; return null; }
    try {
      return await deps.gmail.getMeta(id);
    } catch (err) {
      if (!isNotFound(err)) { unjudged++; log("weekly.spam_read_failed", { id, error: errText(err) }); }
      return null;
    }
  });

  if (ids.length > 0 && metas.every(m => !m) && (unjudged > 0 || incomplete)) throw new Error("spam check: no message could be read");

  const candidates: SpamCandidate[] = [];
  // A sender or domain the owner ruled important, or told to keep, is flagged whatever the
  // model says ("you have a rule for this sender"). But Spam is where forged From headers
  // land (SPF/DKIM failures), so a rule is no proof the mail is from them: rule-matched mail
  // goes to the model like the rest, and ITS verdict says whether it looks like phishing.
  const ruled = new Map<string, string>(); // id → the matching rule's slug
  for (const m of metas) {
    if (!m) continue;
    const rule = deps.store.findRuleFor(m.fromEmail, m.fromDomain);
    if (rule && (rule.verdict === "important" || rule.action === "keep")) ruled.set(m.id, rule.slug);
    const r = riskSignals(m);
    const line = attachmentLine(m.attachments);
    candidates.push({ id: m.id, from: m.from, subject: m.subject, snippet: m.snippet, bulk: r.bulk, transactional: r.transactional, ...(line ? { attachmentLine: line } : {}) });
  }

  let judged = 0;
  let batchesBack = 0; // model calls that came back at all (their verdicts may still be unusable)
  const verdictById = new Map<string, SpamVerdict>(); // a candidate with no entry was not judged
  for (let i = 0; i < candidates.length; i += SPAM_BATCH) {
    if (deps.now() >= deps.deadline) { incomplete = true; break; }
    const batch = candidates.slice(i, i + SPAM_BATCH);
    let res: { verdicts: SpamVerdict[]; unjudged: number } | typeof TIMED_OUT;
    try {
      res = await beforeDeadline(deps.llm.reviewSpam(batch), deps.deadline - deps.now());
    } catch (err) {
      // A failed call judged nothing: the whole batch is "couldn't judge".
      unjudged += batch.length;
      log("weekly.spam_review_failed", { n: batch.length, error: errText(err) });
      continue;
    }
    if (res === TIMED_OUT) { incomplete = true; break; }
    batchesBack++;
    unjudged += res.unjudged;
    // Only ids from THIS batch count, each at most once (the first verdict wins): a flagged
    // id becomes a rescue ref, so an id the model invented must never reach the report.
    const open = new Set(batch.map(c => c.id));
    for (const v of res.verdicts) {
      if (!open.has(v.id)) continue;
      open.delete(v.id);
      verdictById.set(v.id, v);
      judged++;
    }
  }
  if (candidates.length > 0 && batchesBack === 0) throw new Error("spam check: no batch could be judged");

  // Rule-matched first, then what the model judged legitimate; each in the order read.
  const flagged: FlaggedSpam[] = [];
  for (const c of candidates) {
    const slug = ruled.get(c.id);
    if (slug === undefined) continue;
    const v = verdictById.get(c.id);
    // Not judged (a missing or malformed verdict, a failed batch, the deadline): suspicious.
    // Rescuing a forged sender is the costly error, so caution is the default — a
    // "spam-phishing" ref needs the owner's explicit confirmation.
    flagged.push({ id: c.id, from: c.from, subject: c.subject, reason: `rule:${slug}`, suspicious: v ? v.suspicious === true : true, byRule: true });
  }
  for (const c of candidates) {
    const v = verdictById.get(c.id);
    if (ruled.has(c.id) || v?.legitimate !== true) continue;
    flagged.push({ id: c.id, from: c.from, subject: c.subject, reason: v.reason, suspicious: v.suspicious === true, byRule: false });
  }
  return { total: ids.length, flagged, judged, unjudged, capped, incomplete };
}
