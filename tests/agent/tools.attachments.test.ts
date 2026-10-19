// tests/agent/tools.attachments.test.ts
import { describe, it, expect } from "vitest";
import { readOnlyTools, dispatchTool } from "../../src/agent/tools.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { KB, filePart, withAttachments } from "../fixtures/mime.js";

const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
function ctx() {
  const inv = withAttachments("inv", "See the attached invoice.", [filePart("1", "invoice.pdf", "application/pdf", 120 * KB), filePart("2", "terms.docx", WORD, 45 * KB)], { from: "Acme <billing@acme.com>", subject: "Invoice" });
  return { userId: 1, memory: inMemoryStore(), gmail: fakeGmailClient({ historyId: "1", addedSince: {}, messages: { inv }, searchResults: { "in:inbox from:acme.com": ["inv"] } }) };
}

describe("attachments in the chat tools", () => {
  it("read_messages lists each message's attachments (name, type, size) beside its body", async () => {
    const r = await dispatchTool("read_messages", { ids: ["inv"] }, ctx(), readOnlyTools()) as any[];
    expect(r[0].bodyText).toBe("See the attached invoice.");
    expect(r[0].attachments).toEqual([{ name: "invoice.pdf", mimeType: "application/pdf", size: 120 * KB }, { name: "terms.docx", mimeType: WORD, size: 45 * KB }]);
  });
  it("search_gmail gives each row a one-line attachment summary, never Gmail's bulky attachment ids", async () => {
    const r = await dispatchTool("search_gmail", { query: "from:acme.com" }, ctx(), readOnlyTools()) as any[];
    expect(r[0].attachments).toBe("invoice.pdf (PDF, 120 KB), terms.docx (Word, 45 KB)");
    expect(JSON.stringify(r)).not.toContain("att-1");
  });
});
