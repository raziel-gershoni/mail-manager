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
