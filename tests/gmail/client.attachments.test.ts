// tests/gmail/client.attachments.test.ts
import { describe, it, expect } from "vitest";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { parseMessage } from "../../src/gmail/headers.js";
import { KB, filePart, inlineImage, multipart, rawMessage, textPart, withAttachments } from "../fixtures/mime.js";

describe("parseMessage on a format-full message", () => {
  it("keeps only the headers callers read (format full returns every Received/DKIM header)", () => {
    const m = parseMessage(rawMessage("m1", textPart("", "hi"), { from: "Acme <a@acme.com>", subject: "Hi", headers: [
      { name: "Date", value: "Tue, 30 Jun 2026 10:00:00 +0000" }, { name: "Received", value: "from mx.example.com by mx.google.com" },
      { name: "DKIM-Signature", value: "v=1; a=rsa-sha256; d=acme.com" }, { name: "List-Unsubscribe", value: "<mailto:u@acme.com>" }, { name: "Precedence", value: "bulk" },
    ] }));
    expect(Object.keys(m.headers).sort()).toEqual(["date", "from", "list-unsubscribe", "precedence", "subject"]);
    expect(m.fromEmail).toBe("a@acme.com");
  });
  it("carries the message's attachments, with the noise images dropped", () => {
    const m = parseMessage(rawMessage("m1", multipart("", "related", [
      textPart("0", "<p>see the chart</p>", "text/html"), inlineImage("1", "image/png", 340 * KB), inlineImage("2", "image/gif", 1 * KB),
    ])));
    expect(m.attachments.map(a => [a.filename, a.size])).toEqual([["image-1.png", 340 * KB]]);
  });
});

describe("fakeGmailClient with real part trees", () => {
  const nested = withAttachments("inv", "Please pay by Friday.", [filePart("1", "invoice.pdf", "application/pdf", 120 * KB)], { from: "billing@acme.com", subject: "Invoice" });
  const bare = { id: "bare", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "x@y.com" }] } };

  it("getMeta builds the attachments from the payload", async () => {
    const g = fakeGmailClient({ historyId: "1", addedSince: {}, messages: { inv: nested } });
    expect((await g.getMeta("inv")).attachments.map(a => a.filename)).toEqual(["invoice.pdf"]);
  });
  it("readFull decodes the nested body itself when none is scripted (the empty-body regression)", async () => {
    const g = fakeGmailClient({ historyId: "1", addedSince: {}, messages: { inv: nested } });
    const r = await g.readFull("inv");
    expect(r.bodyText).toBe("Please pay by Friday.");
    expect(r.meta.attachments).toHaveLength(1);
  });
  it("a scripted body still wins, and a header-only fixture still reads as empty with no attachments", async () => {
    const g = fakeGmailClient({ historyId: "1", addedSince: {}, messages: { inv: nested, bare }, bodies: { inv: "<p>scripted</p>" } });
    expect((await g.readFull("inv")).bodyText).toBe("scripted");
    const r = await g.readFull("bare");
    expect(r.bodyText).toBe("");
    expect(r.meta.attachments).toEqual([]);
  });
});
