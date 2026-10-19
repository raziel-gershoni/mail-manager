// tests/fixtures/mime.ts
// Builders for Gmail MIME part trees as users.messages.get (format "full") returns them:
// partId "" on the root payload, filename "" on parts that aren't attachments, body.data
// in base64url, and larger files referenced by body.attachmentId.
import type { GmailPart } from "../../src/gmail/parts.js";
import type { GmailRawMessage } from "../../src/gmail/headers.js";

export const KB = 1024;
export const MB = 1024 * 1024;
export const b64url = (s: string): string => Buffer.from(s, "utf8").toString("base64url");

type Header = { name: string; value: string };

export function textPart(partId: string, text: string, mimeType: "text/plain" | "text/html" = "text/plain"): GmailPart {
  return { partId, mimeType, filename: "", headers: [{ name: "Content-Type", value: `${mimeType}; charset="UTF-8"` }], body: { size: Buffer.byteLength(text), data: b64url(text) } };
}

// A file attached the usual way: disposition attachment, bytes behind an attachmentId.
export function filePart(partId: string, filename: string, mimeType: string, size: number): GmailPart {
  return {
    partId, mimeType, filename,
    headers: [{ name: "Content-Type", value: `${mimeType}; name="${filename}"` }, { name: "Content-Disposition", value: `attachment; filename="${filename}"` }],
    body: { attachmentId: `att-${partId}`, size },
  };
}

// An image embedded in the HTML body (Content-ID, disposition inline); Gmail usually gives
// these no filename. `data` puts the bytes inline with no attachmentId, as Gmail does for small parts.
export function inlineImage(partId: string, mimeType: string, size: number, opts: { filename?: string; data?: string } = {}): GmailPart {
  return {
    partId, mimeType, filename: opts.filename ?? "",
    headers: [{ name: "Content-Type", value: mimeType }, { name: "Content-ID", value: `<img-${partId}@mail>` }, { name: "Content-Disposition", value: "inline" }],
    body: opts.data !== undefined ? { size, data: opts.data } : { attachmentId: `att-${partId}`, size },
  };
}

export function multipart(partId: string, subtype: "mixed" | "alternative" | "related", parts: GmailPart[]): GmailPart {
  return { partId, mimeType: `multipart/${subtype}`, filename: "", headers: [{ name: "Content-Type", value: `multipart/${subtype}; boundary="b${partId}"` }], body: { size: 0 }, parts };
}

// A whole message: the root payload carries the RFC 2822 headers.
export function rawMessage(id: string, payload: GmailPart, h: { from?: string; subject?: string; headers?: Header[] } = {}): GmailRawMessage {
  const top: Header[] = [{ name: "From", value: h.from ?? "Sender <sender@example.com>" }, { name: "Subject", value: h.subject ?? "Hello" }, ...(h.headers ?? [])];
  return { id, threadId: `t-${id}`, snippet: "", payload: { ...payload, headers: [...top, ...(payload.headers ?? [])] } };
}

// The usual real shape: mixed → (alternative → text/plain + text/html) + the attached
// files (give them partIds "1", "2", …).
export function withAttachments(id: string, body: string, files: GmailPart[], h: { from?: string; subject?: string; headers?: Header[] } = {}): GmailRawMessage {
  return rawMessage(id, multipart("", "mixed", [
    multipart("0", "alternative", [textPart("0.0", body), textPart("0.1", `<p>${body}</p>`, "text/html")]),
    ...files,
  ]), h);
}

// A "sliced" marketing email: the design cut into many mid-size inline images (slice n is
// 29 KB + n KB, so the last slice is the largest), no documents, plus a 43-byte tracking pixel.
export function slicedNewsletter(id: string, slices: number, h: { from?: string; subject?: string } = {}): GmailRawMessage {
  return rawMessage(id, multipart("", "related", [
    textPart("0", "<html><body><img src='cid:img-1@mail'></body></html>", "text/html"),
    ...Array.from({ length: slices }, (_, i) => inlineImage(String(i + 1), "image/png", 30 * KB + i * KB)),
    inlineImage(String(slices + 1), "image/gif", 43, { data: b64url("GIF89a") }),
  ]), h);
}

// Bytes for every attachmentId in the given messages, for fakeGmailClient's `attachments`
// option: each file's bytes are "<messageId>:<filename or partId>". The fixtures reuse
// attachmentIds across messages (att-1, …), so for a shared id the later message's bytes
// win — tests that mix messages assert on file names, not on bytes.
export function attachmentBytes(...raws: GmailRawMessage[]): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (p: GmailPart | undefined, messageId: string): void => {
    if (!p) return;
    const id = p.body?.attachmentId;
    if (id) out[id] = b64url(`${messageId}:${p.filename || p.partId}`);
    for (const c of p.parts ?? []) visit(c, messageId);
  };
  for (const r of raws) visit(r.payload, r.id);
  return out;
}
