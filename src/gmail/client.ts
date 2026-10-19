import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { parseMessage, type EmailMeta, type GmailRawMessage } from "./headers.js";
import { findBodyPart } from "./parts.js";
import { htmlToText } from "./html.js";
import { mapLimit } from "../util/concurrency.js";

const MAX_BODY_CHARS = 40_000;
export const GMAIL_FETCH_CONCURRENCY = 8;

// The text body: the first text/plain part anywhere in the part tree, else the first
// text/html (stripped by bodyText). Recursive — a mail with attachments nests its body
// (multipart/mixed → multipart/alternative → text/plain), which a one-level scan missed.
function decodeBody(raw: GmailRawMessage): string {
  const part = findBodyPart(raw.payload);
  return part ? Buffer.from(part.data, "base64url").toString("utf8") : "";
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
  countMessages(q: string): Promise<number>;
  readFull(id: string): Promise<{ meta: EmailMeta; bodyText: string }>;
  trash(ids: string[]): Promise<void>;
  untrash(ids: string[]): Promise<void>;
  restore(ids: string[]): Promise<void>; // un-trash AND return to the inbox (removes TRASH, adds INBOX)
  trashedIds?(): string[]; // test-only introspection (implemented on the fake)
  restoredIds?(): string[]; // test-only introspection (fake)
  archive(ids: string[]): Promise<void>;
  unarchive(ids: string[]): Promise<void>;
  archivedIds?(): string[]; // test-only introspection (fake)
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
      // format "full" (not "metadata") so the part tree is there to list attachments: the
      // same one call and quota units, just a larger response. parseMessage keeps only the
      // headers callers read, as metadataHeaders used to.
      const res = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      return parseMessage(res.data as GmailRawMessage);
    },
    async search(q, max = 25) {
      const res = await gmail.users.messages.list({ userId: "me", q, maxResults: max });
      const ids = (res.data.messages ?? []).map(m => m.id!).filter(Boolean);
      return mapLimit(ids, GMAIL_FETCH_CONCURRENCY, id => c.getMeta(id));
    },
    async countMessages(q) {
      let count = 0; let pageToken: string | undefined; let pages = 0;
      do {
        const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 500, pageToken });
        count += (res.data.messages ?? []).length;
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken && ++pages < 40);
      return count;
    },
    async readFull(id) {
      const res = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const raw = res.data as GmailRawMessage;
      return { meta: parseMessage(raw), bodyText: bodyText(raw) };
    },
    async trash(ids) {
      if (ids.length === 0) return;
      await gmail.users.messages.batchModify({ userId: "me", requestBody: { ids, addLabelIds: ["TRASH"] } });
    },
    async untrash(ids) {
      if (ids.length === 0) return;
      await gmail.users.messages.batchModify({ userId: "me", requestBody: { ids, removeLabelIds: ["TRASH"] } });
    },
    async restore(ids) {
      // Un-trash AND ensure it lands in the inbox (works even for mail Gmail's own
      // trash had removed from the inbox), so "un-trash them" reliably returns mail.
      if (ids.length === 0) return;
      await gmail.users.messages.batchModify({ userId: "me", requestBody: { ids, removeLabelIds: ["TRASH"], addLabelIds: ["INBOX"] } });
    },
    async archive(ids) {
      if (ids.length === 0) return;
      await gmail.users.messages.batchModify({ userId: "me", requestBody: { ids, removeLabelIds: ["INBOX"] } });
    },
    async unarchive(ids) {
      if (ids.length === 0) return;
      await gmail.users.messages.batchModify({ userId: "me", requestBody: { ids, addLabelIds: ["INBOX"] } });
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
  const trashed = new Set<string>();
  const archivedFromInbox = new Set<string>();
  const restored = new Set<string>();
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
    async countMessages(q) {
      return (opts.searchResults?.[q] ?? []).length;
    },
    async readFull(id) {
      const raw = opts.messages[id];
      if (!raw) throw new Error(`no fake message ${id}`);
      // A scripted body wins; otherwise decode the payload's own part tree exactly as the
      // real client does, so a nested-MIME fixture runs the real body walk.
      const scripted = opts.bodies?.[id];
      const body = scripted !== undefined ? htmlToText(scripted).slice(0, MAX_BODY_CHARS) : bodyText(raw);
      return { meta: parseMessage(raw), bodyText: body };
    },
    async trash(ids) { for (const id of ids) trashed.add(id); },
    async untrash(ids) { for (const id of ids) trashed.delete(id); },
    async restore(ids) { for (const id of ids) { trashed.delete(id); archivedFromInbox.delete(id); restored.add(id); } },
    trashedIds() { return [...trashed]; },
    restoredIds() { return [...restored]; },
    async archive(ids) { for (const id of ids) archivedFromInbox.add(id); },
    async unarchive(ids) { for (const id of ids) archivedFromInbox.delete(id); },
    archivedIds() { return [...archivedFromInbox]; },
  };
  return c;
}
