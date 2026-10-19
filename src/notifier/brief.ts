// src/notifier/brief.ts
import type { GmailClient } from "../gmail/client.js";
import type { LLMProvider, BriefEmail } from "../llm/provider.js";
import type { MemoryStore } from "../memory/store.js";
import { MAX_BRIEF_ATTACHMENTS, MAX_READ_BYTES_PER_EMAIL, MAX_READ_FILES_PER_EMAIL, prioritize, selectForReading, type AttachmentMeta } from "../gmail/parts.js";
import { ATTACHMENT_READ_CONCURRENCY, readAttachments, type AttachmentRead } from "../attachments/read.js";
import { mapLimit } from "../util/concurrency.js";
import { log } from "../util/log.js";
import { ruleTag } from "../agent/rule-tag.js";
import { dateContext } from "../context/date.js";
import { languageDirective } from "../telegram/bot.js";
import { t, type Lang } from "../i18n/index.js";

export const MAX_BRIEF_BODIES = 8;
// Per-file extract in the brief: enough for an invoice's or a letter's key facts, small
// enough that ten of them keep the brief prompt lean.
export const BRIEF_ATTACHMENT_CHARS = 3_000;
// The brief may START reading attachments until this long after the poll-loop deadline
// (run start + 240s). Past that it names them only, so writing the brief, sending it and
// committing keep their share of the 300s function.
export const BRIEF_ATTACHMENT_GRACE_MS = 40_000;

type NotRead = Exclude<AttachmentRead["status"], "read">;
const notRead = (a: AttachmentMeta, status: NotRead): AttachmentRead => ({ name: a.filename, mimeType: a.mimeType, size: a.size, status });

// Reads the attachments of the brief's important emails: each email's own caps first
// (7 files / 20 MB, by priority), then at most MAX_BRIEF_ATTACHMENTS across the whole
// brief — documents first across ALL its emails, then images largest first — at
// BRIEF_ATTACHMENT_CHARS each. Never throws: a file that isn't read is listed by name
// with why, and the brief goes on. Returns one list per email, in that email's priority order.
async function briefAttachments(
  emails: { messageId: string; atts: AttachmentMeta[] }[],
  deps: { gmail: GmailClient; llm: LLMProvider; readAttachmentsBy?: number; now?: () => number },
): Promise<AttachmentRead[][]> {
  const now = deps.now ?? Date.now;
  const inTime = (): boolean => deps.readAttachmentsBy === undefined || now() < deps.readAttachmentsBy;
  const result = new Map<AttachmentMeta, AttachmentRead>();
  const owner = new Map<AttachmentMeta, string>();
  const pool: AttachmentMeta[] = [];
  for (const e of emails) {
    const { selected, skipped } = selectForReading(e.atts, { maxFiles: MAX_READ_FILES_PER_EMAIL, maxBytes: MAX_READ_BYTES_PER_EMAIL });
    for (const s of skipped) result.set(s.attachment, notRead(s.attachment, s.reason === "cap" ? "skipped" : s.reason));
    for (const a of selected) { owner.set(a, e.messageId); pool.push(a); }
  }
  // Past the cutoff nothing is read: every file is named only.
  const ranked = prioritize(pool);
  const chosen = inTime() ? ranked.slice(0, MAX_BRIEF_ATTACHMENTS) : [];
  for (const a of ranked.slice(chosen.length)) result.set(a, notRead(a, "skipped"));
  try {
    const reads = await mapLimit(chosen, ATTACHMENT_READ_CONCURRENCY, async (a): Promise<AttachmentRead> => {
      if (!inTime()) return notRead(a, "skipped"); // re-checked per file: no new read starts after the cutoff
      const [r] = await readAttachments(owner.get(a)!, [a], { gmail: deps.gmail, llm: deps.llm }, { maxFiles: 1, maxBytes: MAX_READ_BYTES_PER_EMAIL, maxCharsPerFile: BRIEF_ATTACHMENT_CHARS });
      return r ?? notRead(a, "failed");
    });
    chosen.forEach((a, i) => result.set(a, reads[i] ?? notRead(a, "failed")));
  } catch (err) {
    // readAttachments already isolates each file; this only keeps the brief itself safe.
    log("brief.attachments_failed", { error: err instanceof Error ? err.message : String(err) });
    for (const a of chosen) if (!result.has(a)) result.set(a, notRead(a, "failed"));
  }
  const all = [...result.values()];
  log("brief.attachments", { files: all.length, chosen: chosen.length, read: all.filter(r => r.status === "read").length, failed: all.filter(r => r.status === "failed").length });
  return emails.map(e => prioritize(e.atts).map(a => result.get(a) ?? notRead(a, "skipped")));
}

export async function generateBrief(
  ids: string[],
  deps: {
    gmail: GmailClient; llm: LLMProvider; timezone?: string; language?: Lang; store?: MemoryStore;
    readAttachmentsBy?: number; // epoch ms: no attachment read starts after this (the poll passes deadline + BRIEF_ATTACHMENT_GRACE_MS)
    now?: () => number;         // test seam; defaults to Date.now
  },
): Promise<string | null> {
  if (ids.length === 0) return null;
  const emails: BriefEmail[] = [];
  const withFiles: { index: number; messageId: string; atts: AttachmentMeta[] }[] = [];
  for (const id of ids.slice(0, MAX_BRIEF_BODIES)) {
    const f = await deps.gmail.readFull(id);
    if (f.meta.attachments.length > 0) withFiles.push({ index: emails.length, messageId: id, atts: f.meta.attachments });
    emails.push({ from: f.meta.from, subject: f.meta.subject, bodyText: f.bodyText, rule: deps.store ? ruleTag(deps.store.findRuleFor(f.meta.fromEmail, f.meta.fromDomain)) : null });
  }
  for (const id of ids.slice(MAX_BRIEF_BODIES)) {
    const m = await deps.gmail.getMeta(id);
    emails.push({ from: m.from, subject: m.subject, bodyText: m.snippet, rule: deps.store ? ruleTag(deps.store.findRuleFor(m.fromEmail, m.fromDomain)) : null });
  }
  // Only the emails whose bodies were read (the first MAX_BRIEF_BODIES) get their files read.
  if (withFiles.length > 0) {
    const reads = await briefAttachments(withFiles, deps);
    withFiles.forEach((w, i) => { emails[w.index]!.attachments = reads[i] ?? []; });
  }
  // The language directive rides in the brief context so the brief is written in
  // the user's language regardless of the mail's language.
  const context = `${dateContext(new Date(), deps.timezone ?? "UTC")}\n\n${languageDirective(deps.language ?? "en")}`;
  return deps.llm.writeBrief(emails, context);
}

export interface PollActivity { processed: number; surfaced: number; trashed: number; archived: number; unruled: string[]; remaining: number; cursorExpired: boolean; }

// Compose the poll's outgoing Telegram message from the important-mail brief and
// the cycle's activity. ALWAYS returns a message for a real (non-first) cycle: a
// heartbeat when no mail arrived, otherwise a report of what it did — even when
// nothing was important. (The owner asked for a report every check.) When mail was
// left from senders with no rule yet, they're flagged so the owner can teach one.
export function composePollMessage(brief: string | null, a: PollActivity, lang: Lang): string {
  // The history cursor expired and the poll restarted from now without covering anything:
  // say so, so the owner looks through Gmail for what arrived in between.
  if (a.cursorExpired) return t(lang, "poll_cursor_expired");
  // A catch-up that ran out of time says so explicitly, as the last line, so the owner
  // knows the brief is partial (and can check Gmail rather than wait for the next run).
  const warning = a.remaining > 0 ? t(lang, "poll_incomplete", { n: a.remaining }) : "";
  if (a.processed === 0) return warning || t(lang, "poll_heartbeat");
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
  let out = head;
  if (a.unruled.length > 0) {
    const names = a.unruled.slice(0, 5).join(", ");
    const more = a.unruled.length > 5 ? t(lang, "poll_more", { n: a.unruled.length - 5 }) : "";
    const line = a.unruled.length > 1
      ? t(lang, "poll_unruled_many", { names, more })
      : t(lang, "poll_unruled_one", { names, more });
    out = `${head}\n${line}`;
  }
  return warning ? `${out}\n${warning}` : out;
}

// Whether the poll's message goes out without a notification sound. Routine reports and
// heartbeats are silent; important mail, a catch-up that couldn't finish, or a restart
// after an expired cursor buzzes.
export function pollSilent(hasImportant: boolean, remaining: number, cursorExpired: boolean): boolean {
  return !hasImportant && remaining === 0 && !cursorExpired;
}
