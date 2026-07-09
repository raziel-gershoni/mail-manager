export interface GmailHeader { name: string; value: string; }
export interface GmailRawMessage {
  id: string; threadId: string; snippet?: string;
  labelIds?: string[]; // Gmail returns these on every messages.get (all formats)
  payload?: { headers?: GmailHeader[] };
}
export interface EmailMeta {
  id: string; threadId: string; from: string; fromEmail: string; fromDomain: string;
  subject: string; snippet: string; date: Date; headers: Record<string, string>;
  labelIds: string[]; // e.g. ["INBOX","SENT"]; a SENT label means the owner sent it (not incoming)
}

function parseAddress(from: string): { email: string; domain: string } {
  const m = from.match(/<([^>]+)>/);
  const email = (m ? m[1]! : from).trim().toLowerCase();
  const domain = email.includes("@") ? email.split("@")[1]! : "";
  return { email, domain };
}

export function parseMessage(raw: GmailRawMessage): EmailMeta {
  const headers: Record<string, string> = {};
  for (const h of raw.payload?.headers ?? []) headers[h.name.toLowerCase()] = h.value;
  const from = headers["from"] ?? "";
  const { email, domain } = parseAddress(from);
  const dateStr = headers["date"];
  const date = dateStr ? new Date(dateStr) : new Date(0);
  return {
    id: raw.id, threadId: raw.threadId, from, fromEmail: email, fromDomain: domain,
    subject: headers["subject"] ?? "", snippet: raw.snippet ?? "",
    date: isNaN(date.getTime()) ? new Date(0) : date, headers,
    labelIds: raw.labelIds ?? [],
  };
}
