// tests/agent/read-attachment.test.ts
import { describe, it, expect } from "vitest";
import { readOnlyTools, dispatchTool, type ToolContext } from "../../src/agent/tools.js";
import { activityFooter } from "../../src/telegram/bot.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeLLM, type LLMProvider } from "../../src/llm/provider.js";
import type { AttachmentMeta } from "../../src/gmail/parts.js";
import type { GmailRawMessage } from "../../src/gmail/headers.js";
import { TRUNCATION_MARK } from "../../src/attachments/read.js";
import { READ_ATTACHMENT_ONE_CHARS, READ_ATTACHMENT_TOTAL_CHARS, extractBudget } from "../../src/attachments/tool.js";
import { KB, MB, filePart, rawMessage, textPart, withAttachments, attachmentBytes } from "../fixtures/mime.js";

const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
type File = { name: string; mimeType: string; data: string };
type Result = {
  ok: boolean; id?: string; error?: string; attachments?: string[]; note?: string;
  files?: Array<{ name: string; mimeType: string; size: number; status: string; untrustedText?: string; reason?: string }>;
};

const docs = withAttachments("m1", "Documents attached.", [
  filePart("1", "invoice.pdf", "application/pdf", 120 * KB),
  filePart("2", "contract.docx", WORD, 45 * KB),
  filePart("3", "scan.png", "image/png", 300 * KB),
  filePart("4", "archive.pdf", "application/pdf", 25 * MB),
], { from: "Acme <billing@acme.com>", subject: "Your documents" });
const threePdfs = withAttachments("m3", "Three files.", [
  filePart("1", "a.pdf", "application/pdf", 10 * KB), filePart("2", "b.pdf", "application/pdf", 10 * KB), filePart("3", "c.pdf", "application/pdf", 10 * KB),
]);

function setup(raw: GmailRawMessage = docs, extract: (f: File) => string | Promise<string> = f => `TEXT of ${f.name}`) {
  const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: { [raw.id]: raw }, attachments: attachmentBytes(raw) });
  const fetched: string[] = [];
  const orig = gmail.getAttachment.bind(gmail);
  gmail.getAttachment = async (id: string, a: AttachmentMeta) => { fetched.push(a.filename); return orig(id, a); };
  const files: File[] = [];
  const llm: LLMProvider = {
    ...fakeLLM(() => ({ important: false, suspicious: false, reason: "" })),
    async extractAttachment(f) { files.push(f); return extract(f); },
  };
  const ctx: ToolContext = { userId: 1, gmail, memory: inMemoryStore(), llm };
  const run = async (args: Record<string, unknown>) => await dispatchTool("read_attachment", args, ctx, readOnlyTools()) as Result;
  return { gmail, fetched, files, run };
}

describe("read_attachment", () => {
  it("is a read-only tool with an activity-footer verb in both languages", () => {
    expect(readOnlyTools().find(t => t.schema.name === "read_attachment")?.mutating).toBe(false);
    expect(activityFooter("read_messages,read_attachment", "en")).toBe("\n\n_· read · read an attachment_");
    expect(activityFooter("read_attachment", "he")).toBe("\n\n_· קראתי קובץ מצורף_");
  });

  it("reads one named file (any case): its extract comes back as untrustedText under an UNTRUSTED note", async () => {
    const s = setup();
    const r = await s.run({ id: "m1", name: "INVOICE.PDF" });
    expect(r.ok).toBe(true);
    expect(r.note).toMatch(/UNTRUSTED/);
    expect(r.files).toEqual([{ name: "invoice.pdf", mimeType: "application/pdf", size: 120 * KB, status: "read", untrustedText: "TEXT of invoice.pdf" }]);
    expect(s.fetched).toEqual(["invoice.pdf"]);
    expect(Buffer.from(s.files[0]!.data, "base64").toString("utf8")).toBe("m1:invoice.pdf");
  });

  it("with no name, reads up to 7 by priority and lists the rest with the reason", async () => {
    const s = setup();
    const r = await s.run({ id: "m1" });
    expect(r.files!.map(f => [f.name, f.status])).toEqual([["invoice.pdf", "read"], ["scan.png", "read"], ["archive.pdf", "too-large"], ["contract.docx", "unreadable"]]);
    expect(r.files![2]!.reason).toMatch(/too large/);
    expect(r.files![3]!.reason).toMatch(/can't open/);
    expect(s.fetched).toEqual(["invoice.pdf", "scan.png"]);
  });

  it("an unreadable type is listed as can't-open, without downloading it", async () => {
    const s = setup();
    const r = await s.run({ id: "m1", name: "contract.docx" });
    expect(r.files).toEqual([{ name: "contract.docx", mimeType: WORD, size: 45 * KB, status: "unreadable", reason: expect.stringMatching(/can't open/) }]);
    expect(s.fetched).toEqual([]);
  });

  it("a file over 20 MB is refused as too large, without downloading it", async () => {
    const s = setup();
    const r = await s.run({ id: "m1", name: "archive.pdf" });
    expect(r.files!.map(f => [f.name, f.status])).toEqual([["archive.pdf", "too-large"]]);
    expect(s.fetched).toEqual([]);
  });

  it("a name that matches nothing returns the real names instead of guessing", async () => {
    const s = setup();
    const r = await s.run({ id: "m1", name: "receipt.pdf" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no attachment named "receipt.pdf"/);
    expect(r.attachments).toEqual(["invoice.pdf", "contract.docx", "scan.png", "archive.pdf"]);
    expect(s.fetched).toEqual([]);
  });

  it("a partial name matching several files asks for the exact one", async () => {
    const s = setup();
    const r = await s.run({ id: "m1", name: ".pdf" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/several/);
    expect(r.attachments).toEqual(["invoice.pdf", "archive.pdf"]);
  });

  it("says so when the message has no attachments", async () => {
    const s = setup(rawMessage("bare", textPart("", "just text")));
    const r = await s.run({ id: "bare" });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/no attachments/) });
  });

  it("splits 35,000 chars evenly across several files and gives one named file 20,000 — under the 40k tool-result cap", async () => {
    const s = setup(threePdfs, () => "x".repeat(50_000));
    const all = await s.run({ id: "m3" });
    const per = Math.floor(READ_ATTACHMENT_TOTAL_CHARS / 3);
    expect(all.files!.map(f => f.untrustedText!.length)).toEqual([per, per, per].map(n => n + TRUNCATION_MARK.length));
    expect(JSON.stringify(all).length).toBeLessThan(40_000);
    const one = await s.run({ id: "m3", name: "b.pdf" });
    expect(one.files!.map(f => f.untrustedText!.length)).toEqual([READ_ATTACHMENT_ONE_CHARS + TRUNCATION_MARK.length]);
    expect(JSON.stringify(one).length).toBeLessThan(40_000);
    expect([extractBudget(1), extractBudget(2), extractBudget(7)]).toEqual([20_000, 17_500, 5_000]);
  });

  // JSON escapes `"`, `\` and newlines, so a quoted-CSV extract takes more JSON chars than
  // the R9 budget counts. Over 40,000, gemini.ts cuts the result mid-JSON and the unread
  // files, listed last, are lost first.
  const CSV_ROW = `"2026-09-01","CARD PAYMENT TO TESCO STORES 3021","-23.40","1,203.11"\n`;
  const quotedCsv = CSV_ROW.repeat(Math.ceil(50_000 / CSV_ROW.length));
  const allQuotes = `"\\`.repeat(25_000);
  // n readable CSVs, then a 25 MB PDF and a Word file: past 7, the extra CSVs are skipped.
  const statements = (n: number) => withAttachments(`s${n}`, "Statements attached.", [
    ...Array.from({ length: n }, (_, i) => filePart(String(i + 1), `statement-${i + 1}.csv`, "text/csv", 10 * KB)),
    filePart(String(n + 1), "archive.pdf", "application/pdf", 25 * MB),
    filePart(String(n + 2), "notes.docx", WORD, 45 * KB),
  ]);

  it.each([
    ["a quoted CSV", 2, quotedCsv], ["a quoted CSV", 9, quotedCsv],
    ["quotes and backslashes only", 2, allQuotes], ["quotes and backslashes only", 9, allQuotes],
  ])("extracts full of JSON escapes (%s, %i files) are cut to keep the result under 40k, and every unread file is still listed", async (_, n, extract) => {
    const s = setup(statements(n), () => extract);
    const r = await s.run({ id: `s${n}` });
    expect(JSON.stringify(r).length).toBeLessThan(40_000);
    const read = r.files!.filter(f => f.status === "read");
    expect(read.map(f => f.name)).toEqual(Array.from({ length: Math.min(n, 7) }, (_, i) => `statement-${i + 1}.csv`));
    for (const f of read) {
      expect(f.untrustedText!.endsWith(TRUNCATION_MARK)).toBe(true);
      const body = f.untrustedText!.slice(0, -TRUNCATION_MARK.length);
      expect(extract.startsWith(body)).toBe(true);
      expect(body.length).toBeGreaterThan(2_000);
    }
    expect(r.files!.filter(f => f.status !== "read").map(f => [f.name, f.status, f.reason])).toEqual([
      ...Array.from({ length: n - Math.min(n, 7) }, (_, i) => [`statement-${i + 8}.csv`, "skipped", expect.stringMatching(/skipped/)]),
      ["archive.pdf", "too-large", expect.stringMatching(/too large/)],
      ["notes.docx", "unreadable", expect.stringMatching(/can't open/)],
    ]);
  });

  it("one named file full of JSON escapes is cut to keep the result under 40k", async () => {
    const s = setup(statements(2), () => allQuotes);
    const r = await s.run({ id: "s2", name: "statement-1.csv" });
    expect(JSON.stringify(r).length).toBeLessThan(40_000);
    const text = r.files![0]!.untrustedText!;
    expect(text.endsWith(TRUNCATION_MARK)).toBe(true);
    expect(allQuotes.startsWith(text.slice(0, -TRUNCATION_MARK.length))).toBe(true);
    expect(text.length).toBeGreaterThan(15_000);
  });

  it("one file failing — download or extraction — is marked failed; the others still come back", async () => {
    const s = setup(threePdfs, f => { if (f.name === "c.pdf") throw new Error("The operation was aborted due to timeout"); return `TEXT of ${f.name}`; });
    const orig = s.gmail.getAttachment.bind(s.gmail);
    s.gmail.getAttachment = async (id: string, a: AttachmentMeta) => { if (a.filename === "b.pdf") throw new Error("socket hang up"); return orig(id, a); };
    const r = await s.run({ id: "m3" });
    expect(r.ok).toBe(true);
    expect(r.files!.map(f => [f.name, f.status, f.untrustedText ?? f.reason])).toEqual([
      ["a.pdf", "read", "TEXT of a.pdf"], ["b.pdf", "failed", "reading it failed"], ["c.pdf", "failed", "reading it failed"],
    ]);
  });

  it("needs the LLM: without one it throws, and the agent loop reports the error", async () => {
    const s = setup();
    const bare: ToolContext = { userId: 1, gmail: s.gmail, memory: inMemoryStore() };
    await expect(dispatchTool("read_attachment", { id: "m1" }, bare, readOnlyTools())).rejects.toThrow(/unavailable/);
  });
});
