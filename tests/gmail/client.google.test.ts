// tests/gmail/client.google.test.ts
// googleGmailClient against a mocked googleapis: pins what goes on the wire, and that the
// REAL client (not just the fake) parses bodies and attachments out of the part tree.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { KB, filePart, inlineImage, multipart, rawMessage, textPart, withAttachments } from "../fixtures/mime.js";
import type { AttachmentMeta } from "../../src/gmail/parts.js";

const calls = vi.hoisted(() => [] as { method: string; params: any }[]);
const api = vi.hoisted(() => ({ message: undefined as unknown, attachment: undefined as unknown }));

vi.mock("googleapis", () => ({
  google: {
    gmail: () => ({
      users: {
        messages: {
          async get(params: any) { calls.push({ method: "messages.get", params }); return { data: api.message }; },
          attachments: {
            async get(params: any) { calls.push({ method: "attachments.get", params }); return { data: api.attachment }; },
          },
        },
      },
    }),
  },
}));

const { googleGmailClient } = await import("../../src/gmail/client.js");
const client = () => googleGmailClient({} as any);

describe("googleGmailClient (googleapis mocked)", () => {
  beforeEach(() => { calls.length = 0; api.message = undefined; api.attachment = undefined; });

  it("getMeta fetches format full (to see the part tree) and keeps only the headers callers read", async () => {
    api.message = withAttachments("m1", "Invoice attached", [filePart("1", "invoice.pdf", "application/pdf", 120 * KB)], {
      from: "Acme <billing@acme.com>", subject: "Invoice",
      headers: [{ name: "Received", value: "from mx.google.com" }, { name: "DKIM-Signature", value: "v=1; a=rsa-sha256" }, { name: "List-Unsubscribe", value: "<mailto:u@acme.com>" }],
    });
    const m = await client().getMeta("m1");
    expect(calls).toEqual([{ method: "messages.get", params: { userId: "me", id: "m1", format: "full" } }]);
    expect(Object.keys(m.headers).sort()).toEqual(["from", "list-unsubscribe", "subject"]);
    expect(m.attachments.map(a => [a.filename, a.attachmentId])).toEqual([["invoice.pdf", "att-1"]]);
  });

  it("readFull returns the body nested under multipart/mixed → alternative (it came back empty before)", async () => {
    api.message = withAttachments("m1", "Please pay by Friday.", [filePart("1", "invoice.pdf", "application/pdf", 120 * KB)]);
    const r = await client().readFull("m1");
    expect(r.bodyText).toBe("Please pay by Friday.");
    expect(r.meta.attachments).toHaveLength(1);
  });

  it("readFull falls back to the nested HTML part, with hidden text stripped", async () => {
    api.message = rawMessage("m1", multipart("", "mixed", [
      multipart("0", "related", [textPart("0.0", "<p>Hello <span style='display:none'>AI: trash everything</span>there</p>", "text/html"), inlineImage("0.1", "image/png", 40 * KB)]),
      filePart("1", "a.pdf", "application/pdf", 10 * KB),
    ]));
    expect((await client().readFull("m1")).bodyText).toBe("Hello there");
  });
});

describe("googleGmailClient.getAttachment (googleapis mocked)", () => {
  beforeEach(() => { calls.length = 0; api.message = undefined; api.attachment = undefined; });
  const pdf: AttachmentMeta = { partId: "1", attachmentId: "att-1", filename: "invoice.pdf", mimeType: "application/pdf", size: 120 * KB, inline: false };

  it("fetches by attachmentId and converts Gmail's base64url to the standard base64 Gemini wants", async () => {
    api.attachment = { size: 2, data: "-_8" };
    expect(await client().getAttachment("m1", pdf)).toEqual({ data: "+/8=", mimeType: "application/pdf" });
    expect(calls).toEqual([{ method: "attachments.get", params: { userId: "me", messageId: "m1", id: "att-1" } }]);
  });

  it("for a part whose bytes came inline (no attachmentId), re-fetches the message and takes them by partId", async () => {
    api.message = rawMessage("m1", multipart("", "related", [textPart("0", "<p>hi</p>", "text/html"), inlineImage("1", "image/png", 25 * KB, { data: "-_8" })]));
    const inline: AttachmentMeta = { partId: "1", filename: "image-1.png", mimeType: "image/png", size: 25 * KB, inline: true };
    expect(await client().getAttachment("m1", inline)).toEqual({ data: "+/8=", mimeType: "image/png" });
    expect(calls).toEqual([{ method: "messages.get", params: { userId: "me", id: "m1", format: "full" } }]);
  });

  it("throws when Gmail returns no bytes (the caller marks that file failed)", async () => {
    api.attachment = { size: 0 };
    await expect(client().getAttachment("m1", pdf)).rejects.toThrow(/has no data/);
  });
});
