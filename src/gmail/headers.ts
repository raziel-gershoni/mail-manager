import { attachmentsFromPayload, type AttachmentMeta, type GmailPart } from "./parts.js";

export interface GmailHeader { name: string; value: string; }
export interface GmailRawMessage {
  id: string; threadId: string; snippet?: string;
  labelIds?: string[]; // Gmail returns these on every messages.get (all formats)
  payload?: GmailPart; // the MIME part tree (format "full"); the root's headers are the message's
}
export interface EmailMeta {
  id: string; threadId: string; from: string; fromEmail: string; fromDomain: string;
  subject: string; snippet: string; date: Date; headers: Record<string, string>;
  labelIds: string[]; // e.g. ["INBOX","SENT"]; SENT or DRAFT means it's the owner's own mail (not incoming)
  attachments: AttachmentMeta[]; // the message's files, tiny images dropped; names are UNTRUSTED sender text
}

// getMeta and readFull fetch format "full", which returns EVERY header (Received/DKIM/ARC
// chains run to kilobytes). Keep only the ones callers read, so EmailMeta — spread into
// search_gmail's tool output — stays as lean as it was under format "metadata".
const KEPT_HEADERS = new Set(["from", "subject", "date", "list-unsubscribe", "precedence"]);

// The owner's own unsent draft. Each save replaces it with a new message id, and a reply
// draft inside an inbox thread shows up in the "added to inbox" history, so anything
// that lists mail must leave it out: it is never incoming mail and never safe to act on.
export function isDraft(m: { labelIds: string[] }): boolean {
  return m.labelIds.includes("DRAFT");
}

function parseAddress(from: string): { email: string; domain: string } {
  const m = from.match(/<([^>]+)>/);
  const email = (m ? m[1]! : from).trim().toLowerCase();
  const domain = email.includes("@") ? email.split("@")[1]! : "";
  return { email, domain };
}

export function parseMessage(raw: GmailRawMessage): EmailMeta {
  const headers: Record<string, string> = {};
  for (const h of raw.payload?.headers ?? []) {
    const name = h.name.toLowerCase();
    if (KEPT_HEADERS.has(name)) headers[name] = h.value;
  }
  const from = headers["from"] ?? "";
  const { email, domain } = parseAddress(from);
  const dateStr = headers["date"];
  const date = dateStr ? new Date(dateStr) : new Date(0);
  return {
    id: raw.id, threadId: raw.threadId, from, fromEmail: email, fromDomain: domain,
    subject: headers["subject"] ?? "", snippet: raw.snippet ?? "",
    date: isNaN(date.getTime()) ? new Date(0) : date, headers,
    labelIds: raw.labelIds ?? [],
    attachments: attachmentsFromPayload(raw.payload),
  };
}
