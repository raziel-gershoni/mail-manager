// tests/attachments/read.test.ts
import { describe, it, expect, vi } from "vitest";
import { readAttachments, ATTACHMENT_READ_CONCURRENCY, TRUNCATION_MARK, NOT_READ_REASON, notReadReason } from "../../src/attachments/read.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { fakeLLM, type LLMProvider } from "../../src/llm/provider.js";
import { MAX_READ_FILES_PER_EMAIL, MAX_READ_BYTES_PER_EMAIL, type AttachmentMeta } from "../../src/gmail/parts.js";
import type { GmailRawMessage } from "../../src/gmail/headers.js";
import { KB, MB, b64url, filePart, inlineImage, multipart, rawMessage, slicedNewsletter, textPart, withAttachments, attachmentBytes } from "../fixtures/mime.js";

const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const CAPS = { maxFiles: MAX_READ_FILES_PER_EMAIL, maxBytes: MAX_READ_BYTES_PER_EMAIL, maxCharsPerFile: 20_000 };
type File = { name: string; mimeType: string; data: string };

function setup(raw: GmailRawMessage, extract: (f: File) => string | Promise<string> = f => `TEXT of ${f.name}`) {
  const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: { [raw.id]: raw }, attachments: attachmentBytes(raw) });
  const fetched: string[] = [];
  const orig = gmail.getAttachment.bind(gmail);
  gmail.getAttachment = async (id: string, a: AttachmentMeta) => { fetched.push(a.filename); return orig(id, a); };
  const files: File[] = [];
  const llm: LLMProvider = {
    ...fakeLLM(() => ({ important: false, suspicious: false, reason: "" })),
    async extractAttachment(f) { files.push(f); return extract(f); },
  };
  return { gmail, llm, fetched, files, atts: async () => (await gmail.getMeta(raw.id)).attachments };
}

describe("readAttachments", () => {
  it("downloads each readable file and hands Gemini standard base64 with the file's type; unreadable ones are listed, not fetched", async () => {
    const raw = withAttachments("m1", "see attached", [filePart("1", "invoice.pdf", "application/pdf", 120 * KB), filePart("2", "terms.docx", WORD, 45 * KB)]);
    const s = setup(raw);
    const reads = await readAttachments("m1", await s.atts(), s, CAPS);
    expect(reads).toEqual([
      { name: "invoice.pdf", mimeType: "application/pdf", size: 120 * KB, status: "read", text: "TEXT of invoice.pdf" },
      { name: "terms.docx", mimeType: WORD, size: 45 * KB, status: "unreadable" },
    ]);
    expect(s.fetched).toEqual(["invoice.pdf"]);
    expect(s.files[0]!.mimeType).toBe("application/pdf");
    expect(s.files[0]!.data).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
    expect(Buffer.from(s.files[0]!.data, "base64").toString("utf8")).toBe("m1:invoice.pdf");
  });

  it("reads a part whose bytes came inline (no attachmentId) by its part id", async () => {
    const raw = rawMessage("m2", multipart("", "related", [textPart("0", "<p>chart below</p>", "text/html"), inlineImage("1", "image/png", 25 * KB, { data: b64url("PNGDATA") })]));
    const s = setup(raw);
    const reads = await readAttachments("m2", await s.atts(), s, CAPS);
    expect(reads.map(r => [r.name, r.status])).toEqual([["image-1.png", "read"]]);
    expect(Buffer.from(s.files[0]!.data, "base64").toString("utf8")).toBe("PNGDATA");
  });

  it("keeps a sliced newsletter to 7 reads — the largest slices — and skips the rest", async () => {
    const s = setup(slicedNewsletter("n1", 12));
    const reads = await readAttachments("n1", await s.atts(), s, CAPS);
    expect(s.fetched).toHaveLength(MAX_READ_FILES_PER_EMAIL);
    expect(reads.filter(r => r.status === "read").map(r => r.name)).toEqual(["image-12.png", "image-11.png", "image-10.png", "image-9.png", "image-8.png", "image-7.png", "image-6.png"]);
    expect(reads.filter(r => r.status === "skipped")).toHaveLength(5);
  });

  it("keeps one email's reads within 20 MB and refuses a file over it, without downloading either", async () => {
    const raw = withAttachments("m3", "big files", [filePart("1", "a.pdf", "application/pdf", 12 * MB), filePart("2", "b.pdf", "application/pdf", 12 * MB), filePart("3", "huge.pdf", "application/pdf", 25 * MB)]);
    const s = setup(raw);
    const reads = await readAttachments("m3", await s.atts(), s, CAPS);
    expect(reads.map(r => [r.name, r.status])).toEqual([["a.pdf", "read"], ["b.pdf", "skipped"], ["huge.pdf", "too-large"]]);
    expect(s.fetched).toEqual(["a.pdf"]);
  });

  it("a download or an extraction that throws marks only that file failed", async () => {
    const raw = withAttachments("m4", "three", [filePart("1", "a.pdf", "application/pdf", 10 * KB), filePart("2", "b.pdf", "application/pdf", 10 * KB), filePart("3", "c.pdf", "application/pdf", 10 * KB)]);
    const s = setup(raw, f => { if (f.name === "c.pdf") throw new Error("The operation was aborted due to timeout"); return `TEXT of ${f.name}`; });
    const orig = s.gmail.getAttachment.bind(s.gmail);
    s.gmail.getAttachment = async (id: string, a: AttachmentMeta) => { if (a.filename === "b.pdf") throw new Error("socket hang up"); return orig(id, a); };
    const reads = await readAttachments("m4", await s.atts(), s, CAPS);
    expect(reads.map(r => [r.name, r.status])).toEqual([["a.pdf", "read"], ["b.pdf", "failed"], ["c.pdf", "failed"]]);
  });

  it("an extract that comes back empty (e.g. a SAFETY or RECITATION finish) marks that file failed, logged — never 'read' with no text", async () => {
    const raw = withAttachments("m7", "three", [filePart("1", "a.pdf", "application/pdf", 10 * KB), filePart("2", "blank.pdf", "application/pdf", 10 * KB), filePart("3", "spaces.pdf", "application/pdf", 10 * KB)]);
    const s = setup(raw, f => (f.name === "blank.pdf" ? "" : f.name === "spaces.pdf" ? " \n\t " : `TEXT of ${f.name}`));
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const reads = await readAttachments("m7", await s.atts(), s, CAPS);
      expect(reads).toEqual([
        { name: "a.pdf", mimeType: "application/pdf", size: 10 * KB, status: "read", text: "TEXT of a.pdf" },
        { name: "blank.pdf", mimeType: "application/pdf", size: 10 * KB, status: "failed" },
        { name: "spaces.pdf", mimeType: "application/pdf", size: 10 * KB, status: "failed" },
      ]);
      const failures = spy.mock.calls
        .map(c => { try { return JSON.parse(c[0] as string) as { event: string; name: string; error: string }; } catch { return null; } })
        .filter(e => e?.event === "attachments.read_failed");
      expect(failures.map(e => [e!.name, e!.error])).toEqual([["blank.pdf", "empty extract"], ["spaces.pdf", "empty extract"]]);
    } finally { spy.mockRestore(); }
  });

  it("trims each extract and cuts one over the cap, marked", async () => {
    const raw = withAttachments("m5", "two", [filePart("1", "long.pdf", "application/pdf", 10 * KB), filePart("2", "short.pdf", "application/pdf", 10 * KB)]);
    const s = setup(raw, f => (f.name === "long.pdf" ? "z".repeat(25_000) : "  short text \n"));
    const reads = await readAttachments("m5", await s.atts(), s, { ...CAPS, maxCharsPerFile: 20_000 });
    expect(reads[0]!.text).toBe("z".repeat(20_000) + TRUNCATION_MARK);
    expect(reads[1]!.text).toBe("short text");
  });

  it("runs at most ATTACHMENT_READ_CONCURRENCY reads at once", async () => {
    let inFlight = 0; let peak = 0;
    const raw = withAttachments("m6", "seven", Array.from({ length: 7 }, (_, i) => filePart(String(i + 1), `f${i + 1}.pdf`, "application/pdf", 10 * KB)));
    const s = setup(raw, async f => { inFlight++; peak = Math.max(peak, inFlight); await new Promise(r => setTimeout(r, 5)); inFlight--; return f.name; });
    const reads = await readAttachments("m6", await s.atts(), s, CAPS);
    expect(reads.every(r => r.status === "read")).toBe(true);
    expect(peak).toBe(ATTACHMENT_READ_CONCURRENCY);
  });

  it("has an owner-facing reason for every status that isn't a read", () => {
    expect(Object.keys(NOT_READ_REASON).sort()).toEqual(["failed", "skipped", "too-large", "unreadable"]);
    expect(notReadReason("unreadable")).toMatch(/can't open/);
    expect(notReadReason("read")).toBe("");
  });
});
