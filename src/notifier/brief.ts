// src/notifier/brief.ts
import type { GmailClient } from "../gmail/client.js";
import type { LLMProvider, BriefEmail } from "../llm/provider.js";
import type { MemoryStore } from "../memory/store.js";
import { ruleTag } from "../agent/rule-tag.js";
import { dateContext } from "../context/date.js";
import { languageDirective } from "../telegram/bot.js";
import { t, type Lang } from "../i18n/index.js";

export const MAX_BRIEF_BODIES = 8;

export async function generateBrief(
  ids: string[],
  deps: { gmail: GmailClient; llm: LLMProvider; timezone?: string; language?: Lang; store?: MemoryStore },
): Promise<string | null> {
  if (ids.length === 0) return null;
  const emails: BriefEmail[] = [];
  for (const id of ids.slice(0, MAX_BRIEF_BODIES)) {
    const f = await deps.gmail.readFull(id);
    emails.push({ from: f.meta.from, subject: f.meta.subject, bodyText: f.bodyText, rule: deps.store ? ruleTag(deps.store.findRuleFor(f.meta.fromEmail, f.meta.fromDomain)) : null });
  }
  for (const id of ids.slice(MAX_BRIEF_BODIES)) {
    const m = await deps.gmail.getMeta(id);
    emails.push({ from: m.from, subject: m.subject, bodyText: m.snippet, rule: deps.store ? ruleTag(deps.store.findRuleFor(m.fromEmail, m.fromDomain)) : null });
  }
  // The language directive rides in the brief context so the brief is written in
  // the user's language regardless of the mail's language.
  const context = `${dateContext(new Date(), deps.timezone ?? "UTC")}\n\n${languageDirective(deps.language ?? "en")}`;
  return deps.llm.writeBrief(emails, context);
}

export interface PollActivity { processed: number; surfaced: number; trashed: number; archived: number; unruled: string[]; }

// Compose the poll's outgoing Telegram message from the important-mail brief and
// the cycle's activity. ALWAYS returns a message for a real (non-first) cycle: a
// heartbeat when no mail arrived, otherwise a report of what it did — even when
// nothing was important. (The owner asked for a report every check.) When mail was
// left from senders with no rule yet, they're flagged so the owner can teach one.
export function composePollMessage(brief: string | null, a: PollActivity, lang: Lang): string {
  if (a.processed === 0) return t(lang, "poll_heartbeat");
  const bits: string[] = [];
  if (a.trashed > 0) bits.push(t(lang, "poll_trashed", { n: a.trashed }));
  if (a.archived > 0) bits.push(t(lang, "poll_archived", { n: a.archived }));
  const left = Math.max(0, a.processed - a.surfaced - a.trashed - a.archived);
  if (bits.length && left > 0) bits.push(t(lang, "poll_left", { n: left })); // show the split only when something was acted on
  const summary = bits.length ? ` · ${bits.join(" · ")}` : "";
  const newCount = t(lang, "poll_new", { n: a.processed });
  const head = brief && brief.trim()
    ? `${brief}\n\n_${newCount}${summary}_`
    : `${newCount} · ${t(lang, "poll_nothing_important")}${summary}`;
  if (a.unruled.length === 0) return head;
  const names = a.unruled.slice(0, 5).join(", ");
  const more = a.unruled.length > 5 ? t(lang, "poll_more", { n: a.unruled.length - 5 }) : "";
  const line = a.unruled.length > 1
    ? t(lang, "poll_unruled_many", { names, more })
    : t(lang, "poll_unruled_one", { names, more });
  return `${head}\n${line}`;
}
