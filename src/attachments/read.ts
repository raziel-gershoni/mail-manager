// src/attachments/read.ts
// Reads an email's attachments on the fly: picks what to read by priority within the
// caller's caps, downloads each file, and asks Gemini for a plain-text extract. Nothing is
// stored. One bad file never sinks the rest: a download error or a Gemini timeout marks
// that file "failed" and the others still come back.
import type { GmailClient } from "../gmail/client.js";
import type { LLMProvider } from "../llm/provider.js";
import { selectForReading, type AttachmentMeta } from "../gmail/parts.js";
import { mapLimit } from "../util/concurrency.js";
import { log } from "../util/log.js";

export interface AttachmentRead { name: string; mimeType: string; size: number; status: "read" | "unreadable" | "too-large" | "skipped" | "failed"; text?: string }

// Files read at once. Each read is a Gmail download plus one Gemini call (40s HTTP
// timeout), so this bounds both the fan-out and the wall time of a 7-file read.
export const ATTACHMENT_READ_CONCURRENCY = 4;
// Appended to an extract cut at the caller's cap, so the reader knows there was more.
export const TRUNCATION_MARK = "\n…[truncated]";

// Why a file wasn't read, in words fit for the owner and for the brief's writer.
export const NOT_READ_REASON: Record<Exclude<AttachmentRead["status"], "read">, string> = {
  unreadable: "can't open this file type — only PDFs, images and text/CSV files can be read",
  "too-large": "too large to read — over 20 MB",
  skipped: "skipped — over the per-email or per-brief file limit, or out of time",
  failed: "reading it failed",
};

export function notReadReason(status: AttachmentRead["status"]): string {
  return status === "read" ? "" : NOT_READ_REASON[status];
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + TRUNCATION_MARK : text;
}

export async function readAttachments(
  messageId: string,
  atts: AttachmentMeta[],
  deps: { gmail: GmailClient; llm: LLMProvider },
  opts: { maxFiles: number; maxBytes: number; maxCharsPerFile: number },
): Promise<AttachmentRead[]> {
  const { selected, skipped } = selectForReading(atts, { maxFiles: opts.maxFiles, maxBytes: opts.maxBytes });
  const read = await mapLimit(selected, ATTACHMENT_READ_CONCURRENCY, async (a): Promise<AttachmentRead> => {
    const file = { name: a.filename, mimeType: a.mimeType, size: a.size };
    // One try/catch PER FILE: mapLimit rejects on the first failure, which would throw
    // away every other file's extract (and fail the brief or the chat turn with it).
    try {
      const bytes = await deps.gmail.getAttachment(messageId, a);
      // The extractor is asked for no more than the caller keeps (maxChars), so a long PDF
      // doesn't time out transcribing text that would be cut anyway.
      const text = (await deps.llm.extractAttachment({ name: a.filename, mimeType: bytes.mimeType, data: bytes.data }, { maxChars: opts.maxCharsPerFile })).trim();
      // No text back (Gemini's SAFETY/RECITATION/OTHER finish, or no candidates, makes
      // res.text undefined → ""): "read" must mean text was obtained, so this is a failure.
      if (text === "") throw new Error("empty extract");
      return { ...file, status: "read", text: truncate(text, opts.maxCharsPerFile) };
    } catch (err) {
      log("attachments.read_failed", { messageId, name: a.filename, mimeType: a.mimeType, size: a.size, error: err instanceof Error ? err.message : String(err) });
      return { ...file, status: "failed" };
    }
  });
  const notRead = skipped.map(({ attachment: a, reason }): AttachmentRead =>
    ({ name: a.filename, mimeType: a.mimeType, size: a.size, status: reason === "cap" ? "skipped" : reason }));
  return [...read, ...notRead];
}
