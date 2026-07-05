// src/notifier/brief.ts
import type { GmailClient } from "../gmail/client.js";
import type { LLMProvider, BriefEmail } from "../llm/provider.js";
import { dateContext } from "../context/date.js";

export const MAX_BRIEF_BODIES = 8;

export async function generateBrief(
  ids: string[],
  deps: { gmail: GmailClient; llm: LLMProvider; timezone?: string },
): Promise<string | null> {
  if (ids.length === 0) return null;
  const emails: BriefEmail[] = [];
  for (const id of ids.slice(0, MAX_BRIEF_BODIES)) {
    const f = await deps.gmail.readFull(id);
    emails.push({ from: f.meta.from, subject: f.meta.subject, bodyText: f.bodyText });
  }
  for (const id of ids.slice(MAX_BRIEF_BODIES)) {
    const m = await deps.gmail.getMeta(id);
    emails.push({ from: m.from, subject: m.subject, bodyText: m.snippet });
  }
  return deps.llm.writeBrief(emails, dateContext(new Date(), deps.timezone ?? "UTC"));
}

export interface PollActivity { processed: number; surfaced: number; trashed: number; archived: number; unruled: string[]; }

// Compose the poll's outgoing Telegram message from the important-mail brief and
// the cycle's activity. ALWAYS returns a message for a real (non-first) cycle: a
// heartbeat when no mail arrived, otherwise a report of what it did — even when
// nothing was important. (The owner asked for a report every check.) When mail was
// left from senders with no rule yet, they're flagged so the owner can teach one.
export function composePollMessage(brief: string | null, a: PollActivity): string {
  if (a.processed === 0) return "🟢 No new mail this check.";
  const bits: string[] = [];
  if (a.trashed > 0) bits.push(`trashed ${a.trashed}`);
  if (a.archived > 0) bits.push(`archived ${a.archived}`);
  const left = Math.max(0, a.processed - a.surfaced - a.trashed - a.archived);
  if (bits.length && left > 0) bits.push(`${left} left in inbox`); // show the split only when something was acted on
  const summary = bits.length ? ` · ${bits.join(" · ")}` : "";
  const head = brief && brief.trim()
    ? `${brief}\n\n_📬 ${a.processed} new${summary}_`
    : `📬 ${a.processed} new · nothing important${summary}`;
  if (a.unruled.length === 0) return head;
  const names = a.unruled.slice(0, 5).join(", ");
  const more = a.unruled.length > 5 ? ` +${a.unruled.length - 5} more` : "";
  return `${head}\n🆕 New sender${a.unruled.length > 1 ? "s" : ""} you haven't ruled: ${names}${more} — reply keep/archive/trash to teach a rule.`;
}
