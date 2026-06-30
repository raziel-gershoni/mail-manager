import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { parseMessage, type EmailMeta, type GmailRawMessage } from "./headers.js";
import { htmlToText } from "./html.js";

const MAX_BODY_CHARS = 40_000;

function decodeBody(raw: GmailRawMessage): string {
  // walk payload parts; prefer text/plain, else text/html (stripped)
  const parts = (raw as any).payload?.parts as any[] | undefined;
  const pick = (mime: string) => {
    if ((raw as any).payload?.mimeType === mime && (raw as any).payload?.body?.data) return (raw as any).payload.body.data;
    for (const p of parts ?? []) if (p.mimeType === mime && p.body?.data) return p.body.data;
    return undefined;
  };
  const b64 = pick("text/plain") ?? pick("text/html");
  if (!b64) return "";
  const decoded = Buffer.from(String(b64), "base64url").toString("utf8");
  return decoded;
}

function bodyText(raw: GmailRawMessage): string {
  const text = htmlToText(decodeBody(raw)).slice(0, MAX_BODY_CHARS);
  return text;
}

export interface GmailClient {
  currentHistoryId(): Promise<string>;
  listAddedMessageIds(startHistoryId: string): Promise<string[]>;
  getMeta(id: string): Promise<EmailMeta>;
  search(q: string, max?: number): Promise<EmailMeta[]>;
  readFull(id: string): Promise<{ meta: EmailMeta; bodyText: string }>;
}

export function googleGmailClient(auth: OAuth2Client): GmailClient {
  const gmail = google.gmail({ version: "v1", auth });
  const c: GmailClient = {
    async currentHistoryId() {
      const res = await gmail.users.getProfile({ userId: "me" });
      return String(res.data.historyId);
    },
    async listAddedMessageIds(startHistoryId) {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const res = await gmail.users.history.list({
          userId: "me", startHistoryId, historyTypes: ["messageAdded"],
          labelId: "INBOX", pageToken,
        });
        for (const h of res.data.history ?? [])
          for (const m of h.messagesAdded ?? [])
            if (m.message?.id) ids.push(m.message.id);
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      return [...new Set(ids)];
    },
    async getMeta(id) {
      const res = await gmail.users.messages.get({
        userId: "me", id, format: "metadata",
        metadataHeaders: ["From","Subject","Date","List-Unsubscribe","Precedence"],
      });
      return parseMessage(res.data as GmailRawMessage);
    },
    async search(q, max = 200) {
      const res = await gmail.users.messages.list({ userId: "me", q, maxResults: max });
      const ids = (res.data.messages ?? []).map(m => m.id!).filter(Boolean);
      const metas: EmailMeta[] = [];
      for (const id of ids) metas.push(await c.getMeta(id));
      return metas;
    },
    async readFull(id) {
      const res = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const raw = res.data as GmailRawMessage;
      return { meta: parseMessage(raw), bodyText: bodyText(raw) };
    },
  };
  return c;
}

export function fakeGmailClient(opts: {
  historyId: string;
  addedSince: Record<string, string[]>;
  messages: Record<string, GmailRawMessage>;
  searchResults?: Record<string, string[]>;
  bodies?: Record<string, string>;
}): GmailClient {
  const c: GmailClient = {
    async currentHistoryId() { return opts.historyId; },
    async listAddedMessageIds(start) { return opts.addedSince[start] ?? []; },
    async getMeta(id) {
      const raw = opts.messages[id];
      if (!raw) throw new Error(`no fake message ${id}`);
      return parseMessage(raw);
    },
    async search(q) {
      return Promise.all((opts.searchResults?.[q] ?? []).map(id => c.getMeta(id)));
    },
    async readFull(id) {
      const raw = opts.messages[id];
      if (!raw) throw new Error(`no fake message ${id}`);
      const body = htmlToText(opts.bodies?.[id] ?? "").slice(0, MAX_BODY_CHARS);
      return { meta: parseMessage(raw), bodyText: body };
    },
  };
  return c;
}
