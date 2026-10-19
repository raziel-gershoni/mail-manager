// tests/notifier/classify.attachments.test.ts
// Wiring pin: the hourly check's getMeta now carries the part tree, so the importance
// check receives the attachments it renders into its prompt.
import { describe, it, expect } from "vitest";
import { runPoll } from "../../src/notifier/poll.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeLLM } from "../../src/llm/provider.js";
import { fakeActionLogRepo } from "../../src/cleanup/proposals.js";
import { fakeSyncRepo, fakeSeenRepo } from "../../src/notifier/sync.js";
import { attachmentLine } from "../../src/gmail/parts.js";
import { KB, filePart, withAttachments } from "../fixtures/mime.js";

describe("the hourly check and attachments", () => {
  it("hands the importance check the message's attachments", async () => {
    const lines: string[] = [];
    const d = {
      userId: 1,
      gmail: fakeGmailClient({ historyId: "200", addedSince: { "100": ["inv"] }, messages: {
        inv: withAttachments("inv", "attached", [filePart("1", "invoice.pdf", "application/pdf", 120 * KB)], { from: "billing@acme.com", subject: "October" }),
      } }),
      store: inMemoryStore(),
      llm: fakeLLM(i => { lines.push(attachmentLine(i.email.attachments)); return { important: true, suspicious: false, reason: "a document" }; }),
      sync: fakeSyncRepo(), seen: fakeSeenRepo(), actionLog: fakeActionLogRepo(),
    };
    await d.sync.set(1, "100");
    const r = await runPoll(d);
    expect(lines).toEqual(["invoice.pdf (PDF, 120 KB)"]);
    expect(r.important.map(i => i.messageId)).toEqual(["inv"]);
  });
});
