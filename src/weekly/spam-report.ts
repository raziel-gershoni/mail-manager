// src/weekly/spam-report.ts
// The weekly spam check's Telegram message. Pure.
import type { DigestRef } from "../notifier/refs.js";
import { t, type Lang } from "../i18n/index.js";
import type { FlaggedSpam, SpamCheck } from "./spam.js";
import { clipLine } from "./text.js";

export const MAX_LISTED = 20;
// Telegram rejects a message over 4096 characters, and the weekly send (sendPlain) sends
// this text as it is, without splitting, so the report keeps under this budget.
export const MAX_REPORT_CHARS = 3800;

// Sender, subject and reason come from the email or the model: one line each, bounded
// (clipLine). They're UNTRUSTED and shown verbatim. The report goes out as plain text
// (sendPlain, no parse_mode), so markdown in them stays literal and never becomes a link.
function item(f: FlaggedSpam, n: number, lang: Lang): string {
  const reason = f.byRule ? t(lang, "spam_by_rule") : clipLine(f.reason, 100);
  const subject = clipLine(f.subject, 80) || t(lang, "poll_no_subject");
  const line = `${n}. ${clipLine(f.from, 60)} — ${subject}${reason ? ` (${reason})` : ""}`;
  return f.suspicious ? `${line}\n   ${t(lang, "spam_phishing")}` : line;
}

// Buzzes when something was flagged, or when nothing was but some couldn't be judged (then
// it never says "nothing looks legitimate": it says how many it could judge and how many
// it couldn't, because the owner should look). Otherwise a silent one-liner. The refs couple
// the message to the exact Gmail ids in the report's numbered order (so "rescue 1 3"
// resolves exactly), one per flagged email — the ones past the listed 20 continue the
// numbering. A possible-phishing ref is kind "spam-phishing", so the agent knows to ask
// before rescuing it.
export function composeSpamReport(c: SpamCheck, lang: Lang): { text: string; silent: boolean; refs: DigestRef[] } {
  const total = c.capped ? `${c.total}+` : String(c.total);
  const notes: string[] = [];
  if (c.capped) notes.push(t(lang, "spam_capped", { n: c.total }));
  if (c.incomplete) notes.push(t(lang, "spam_incomplete"));

  if (c.flagged.length === 0) {
    if (c.total === 0) return { text: [t(lang, "spam_empty"), ...notes].join("\n"), silent: true, refs: [] };
    if (c.unjudged > 0) {
      const head = t(lang, "spam_none_unjudged", { total, judged: c.judged, unjudged: c.unjudged });
      return { text: [head, ...notes].join("\n"), silent: false, refs: [] };
    }
    return { text: [t(lang, "spam_none", { total }), ...notes].join("\n"), silent: true, refs: [] };
  }
  if (c.unjudged > 0) notes.push(t(lang, "spam_unjudged", { n: c.unjudged }));

  // Clean-looking ones first, possible phishing last; otherwise in the check's order.
  const ordered = [...c.flagged.filter(f => !f.suspicious), ...c.flagged.filter(f => f.suspicious)];
  const head = ordered.length === 1 ? t(lang, "spam_head_one", { total }) : t(lang, "spam_head", { total, n: ordered.length });
  const tail = [...notes, t(lang, "spam_reply_hint")];
  // Room kept for the tail and a "+N more" line, so the whole message fits the budget.
  const reserve = tail.join("\n").length + t(lang, "spam_more", { n: ordered.length }).length + 2;
  const lines = [head];
  let used = head.length;
  let listed = 0;
  for (const f of ordered) {
    if (listed >= MAX_LISTED) break;
    const line = item(f, listed + 1, lang);
    if (used + 1 + line.length + reserve > MAX_REPORT_CHARS) break;
    lines.push(line);
    used += 1 + line.length;
    listed++;
  }
  if (ordered.length > listed) lines.push(t(lang, "spam_more", { n: ordered.length - listed }));
  lines.push(...tail);
  const refs = ordered.map(f => ({ id: f.id, from: f.from, subject: f.subject, kind: f.suspicious ? "spam-phishing" : "spam" }));
  return { text: lines.join("\n"), silent: false, refs };
}
