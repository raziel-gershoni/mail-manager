// src/gmail/parts.ts
// Pure walkers over a Gmail message's MIME part tree (users.messages.get, format "full").
// No I/O: the real client and the fake both parse through here, so a test against the
// fake runs the same body and attachment parsing the hourly check runs on real mail.

export interface GmailPart { partId?: string; mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { attachmentId?: string; size?: number; data?: string }; parts?: GmailPart[] }
// One file on a message. `inline` = embedded in the body (Content-ID / disposition inline).
// `attachmentId` is absent when Gmail sent the bytes inside the part itself (small parts).
// Holds NO bytes: this rides on EmailMeta into prompts, tool output and logs.
export interface AttachmentMeta { partId: string; attachmentId?: string; filename: string; mimeType: string; size: number; inline: boolean }

// Icons, tracking pixels, spacers and social badges are all tiny; a scan or an infographic
// is not. Only images under this size are dropped — however they're attached — so a large
// infographic embedded in the body still counts.
export const MIN_IMAGE_BYTES = 20 * 1024;
// Reading caps: per email (by priority), and per brief across all of its emails.
export const MAX_READ_FILES_PER_EMAIL = 7;
export const MAX_READ_BYTES_PER_EMAIL = 20 * 1024 * 1024;
export const MAX_BRIEF_ATTACHMENTS = 10;
// What Gemini transcribes. Anything else (docx, xlsx, zip, gif …) is listed as "can't open".
export const READABLE_MIME_TYPES: readonly string[] = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif", "text/plain", "text/csv"];

const MAX_NAMED_FILES = 5;
const MAX_NAME_CHARS = 120;

// Senders often label a file generically (application/octet-stream) or with a non-standard
// type; the standard name, or else the extension, tells Gemini what it is really getting.
// These tables are indexed with SENDER-CONTROLLED keys (the declared type, the file
// extension), so they are Maps: a plain object would resolve "constructor" / "__proto__"
// through Object.prototype and hand back a function or an object instead of a string.
const MIME_ALIASES: ReadonlyMap<string, string> = new Map([["image/jpg", "image/jpeg"], ["image/pjpeg", "image/jpeg"], ["application/x-pdf", "application/pdf"]]);
const MIME_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  ["pdf", "application/pdf"], ["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["webp", "image/webp"],
  ["heic", "image/heic"], ["heif", "image/heif"], ["txt", "text/plain"], ["csv", "text/csv"],
]);
const TYPE_LABELS: ReadonlyMap<string, string> = new Map([
  ["application/pdf", "PDF"],
  ["application/msword", "Word"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Word"],
  ["application/vnd.ms-excel", "Excel"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Excel"],
  ["application/vnd.ms-powerpoint", "PowerPoint"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "PowerPoint"],
  ["application/zip", "ZIP"], ["application/x-zip-compressed", "ZIP"],
  ["text/plain", "text"], ["text/csv", "CSV"], ["text/calendar", "calendar"], ["message/rfc822", "email"],
]);

function header(p: GmailPart, name: string): string {
  return (p.headers ?? []).find(h => String(h.name).toLowerCase() === name)?.value ?? "";
}

function isAttachmentPart(p: GmailPart): boolean {
  return Boolean(p.filename) || /^\s*attachment/i.test(header(p, "content-disposition"));
}

function isImage(a: { mimeType: string }): boolean {
  return a.mimeType.startsWith("image/");
}

function firstText(p: GmailPart | undefined, mime: "text/plain" | "text/html"): string | null {
  if (!p) return null;
  const data = p.body?.data;
  if (data && !isAttachmentPart(p) && (p.mimeType ?? "").toLowerCase() === mime) return data;
  for (const c of p.parts ?? []) {
    const hit = firstText(c, mime);
    if (hit) return hit;
  }
  return null;
}

// The message's text body: the first text/plain part ANYWHERE in the tree, otherwise the
// first text/html. Recursive because a mail with attachments nests its body
// (multipart/mixed → multipart/alternative → text/plain) — a one-level scan returned ""
// for exactly those. A part that is itself an attachment (a filename, or
// Content-Disposition: attachment — e.g. an attached notes.txt) is never the body.
export function findBodyPart(payload: GmailPart | undefined): { mimeType: "text/plain" | "text/html"; data: string } | null {
  const plain = firstText(payload, "text/plain");
  if (plain) return { mimeType: "text/plain", data: plain };
  const html = firstText(payload, "text/html");
  return html ? { mimeType: "text/html", data: html } : null;
}

// The part with this partId (the root payload's is ""), at any depth.
export function findPart(payload: GmailPart | undefined, partId: string): GmailPart | undefined {
  if (!payload) return undefined;
  if ((payload.partId ?? "") === partId) return payload;
  for (const c of payload.parts ?? []) {
    const hit = findPart(c, partId);
    if (hit) return hit;
  }
  return undefined;
}

// Gmail sends file bytes as base64url; Gemini's inlineData wants standard base64.
export function base64UrlToBase64(data: string): string {
  return Buffer.from(data, "base64url").toString("base64");
}

// Names are UNTRUSTED sender text that lands in prompts: one line, bounded.
function cleanName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_CHARS);
}

function effectiveMime(declared: string, name: string): string {
  const mime = MIME_ALIASES.get(declared) ?? declared;
  if (mime && mime !== "application/octet-stream") return mime;
  const ext = /\.([a-z0-9]+)$/.exec(name.toLowerCase())?.[1];
  return (ext ? MIME_BY_EXTENSION.get(ext) : undefined) ?? (mime || "application/octet-stream");
}

function imageExt(mimeType: string): string {
  const sub = (mimeType.split("/")[1] ?? "").replace(/\+.*$/, "");
  return sub === "jpeg" ? "jpg" : sub || "img";
}

function toAttachment(p: GmailPart): AttachmentMeta | null {
  const declared = (p.mimeType ?? "").toLowerCase();
  if (declared.startsWith("multipart/")) return null; // containers hold parts, not content
  const named = cleanName(p.filename ?? "");
  const mimeType = effectiveMime(declared, named);
  const image = mimeType.startsWith("image/");
  if (!named && !image) return null; // text bodies (and other unnamed parts) aren't attachments
  const size = p.body?.size ?? 0;
  if (image && size < MIN_IMAGE_BYTES) return null; // icons, pixels, spacers, badges
  const partId = p.partId ?? "";
  const disposition = header(p, "content-disposition");
  const inline = /^\s*inline/i.test(disposition) || (!disposition && header(p, "content-id") !== "");
  const attachmentId = p.body?.attachmentId;
  return {
    partId, ...(attachmentId ? { attachmentId } : {}),
    filename: named || `image-${partId || "0"}.${imageExt(mimeType)}`,
    mimeType, size, inline,
  };
}

// Every file on the message: any part with a filename, plus every image part (inline or
// not, named image-<partId>.<ext> when it has no name), minus images under MIN_IMAGE_BYTES.
// Text bodies are never attachments.
export function attachmentsFromPayload(payload: GmailPart | undefined): AttachmentMeta[] {
  const out: AttachmentMeta[] = [];
  const visit = (p: GmailPart | undefined): void => {
    if (!p) return;
    const a = toAttachment(p);
    if (a) out.push(a);
    for (const c of p.parts ?? []) visit(c);
  };
  visit(payload);
  return out;
}

export function isReadable(a: AttachmentMeta): boolean {
  return READABLE_MIME_TYPES.includes(a.mimeType);
}

// Reading order: readable documents (pdf, text, csv) in message order, then readable
// images LARGEST first (so an infographic outranks the slices of a sliced newsletter),
// then everything else.
export function prioritize(atts: AttachmentMeta[]): AttachmentMeta[] {
  const docs = atts.filter(a => isReadable(a) && !isImage(a));
  const images = atts.filter(a => isReadable(a) && isImage(a)).sort((x, y) => y.size - x.size);
  const rest = atts.filter(a => !isReadable(a));
  return [...docs, ...images, ...rest];
}

// What to read under one email's caps, by priority. A file alone over maxBytes is
// "too-large"; one past the file count, or past what's left of the byte budget, is "cap".
export function selectForReading(
  atts: AttachmentMeta[],
  opts: { maxFiles: number; maxBytes: number },
): { selected: AttachmentMeta[]; skipped: { attachment: AttachmentMeta; reason: "unreadable" | "too-large" | "cap" }[] } {
  const selected: AttachmentMeta[] = [];
  const skipped: { attachment: AttachmentMeta; reason: "unreadable" | "too-large" | "cap" }[] = [];
  let bytes = 0;
  for (const a of prioritize(atts)) {
    if (!isReadable(a)) skipped.push({ attachment: a, reason: "unreadable" });
    else if (a.size > opts.maxBytes) skipped.push({ attachment: a, reason: "too-large" });
    else if (selected.length >= opts.maxFiles || bytes + a.size > opts.maxBytes) skipped.push({ attachment: a, reason: "cap" });
    else { selected.push(a); bytes += a.size; }
  }
  return { selected, skipped };
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function typeLabel(a: AttachmentMeta): string {
  const known = TYPE_LABELS.get(a.mimeType);
  if (known) return known;
  if (isImage(a)) return `${imageExt(a.mimeType).toUpperCase()} image`;
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(a.filename)?.[1];
  return ext ? ext.toUpperCase() : "file";
}

// The compact line the importance check and both reviewers see, e.g.
// "invoice.pdf (PDF, 120 KB), contract.docx (Word, 45 KB) + 3 images". At most 5 named
// non-image files, then "+N more"; images are counted, and the largest one is named when
// images are the only content. "" when there are none.
export function attachmentLine(atts: AttachmentMeta[]): string {
  if (atts.length === 0) return "";
  const label = (a: AttachmentMeta) => `${a.filename} (${typeLabel(a)}, ${formatSize(a.size)})`;
  const files = atts.filter(a => !isImage(a));
  const images = atts.filter(a => isImage(a));
  if (files.length === 0) {
    const largest = [...images].sort((x, y) => y.size - x.size)[0]!;
    const others = images.length - 1;
    return others > 0 ? `${label(largest)} + ${others} more ${others === 1 ? "image" : "images"}` : label(largest);
  }
  let line = files.slice(0, MAX_NAMED_FILES).map(label).join(", ");
  if (files.length > MAX_NAMED_FILES) line += ` +${files.length - MAX_NAMED_FILES} more`;
  if (images.length > 0) line += ` + ${images.length} ${images.length === 1 ? "image" : "images"}`;
  return line;
}
