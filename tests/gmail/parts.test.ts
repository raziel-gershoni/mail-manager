// tests/gmail/parts.test.ts
import { describe, it, expect } from "vitest";
import {
  findBodyPart, attachmentsFromPayload, attachmentLine, prioritize, selectForReading, isReadable, findPart, base64UrlToBase64,
  MIN_IMAGE_BYTES, MAX_READ_FILES_PER_EMAIL, MAX_READ_BYTES_PER_EMAIL, READABLE_MIME_TYPES, type AttachmentMeta, type GmailPart,
} from "../../src/gmail/parts.js";
import { b64url, KB, MB, textPart, filePart, inlineImage, multipart, slicedNewsletter } from "../fixtures/mime.js";

const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const decode = (data: string) => Buffer.from(data, "base64url").toString("utf8");
const att = (filename: string, mimeType: string, size: number): AttachmentMeta =>
  ({ partId: filename, attachmentId: `att-${filename}`, filename, mimeType, size, inline: false });
const names = (as: AttachmentMeta[]) => as.map(a => a.filename);

describe("findBodyPart", () => {
  it("finds the text/plain body nested under multipart/mixed → alternative (it came back empty before)", () => {
    const payload = multipart("", "mixed", [
      multipart("0", "alternative", [textPart("0.0", "Please pay by Friday."), textPart("0.1", "<p>Please pay by <b>Friday</b>.</p>", "text/html")]),
      filePart("1", "invoice.pdf", "application/pdf", 120 * KB),
    ]);
    const body = findBodyPart(payload);
    expect(body?.mimeType).toBe("text/plain");
    expect(decode(body!.data)).toBe("Please pay by Friday.");
  });
  it("falls back to the first text/html anywhere when the mail has no text/plain", () => {
    const payload = multipart("", "mixed", [
      multipart("0", "related", [textPart("0.0", "<p>Hello <b>there</b></p>", "text/html"), inlineImage("0.1", "image/png", 40 * KB)]),
      filePart("1", "a.pdf", "application/pdf", 10 * KB),
    ]);
    const body = findBodyPart(payload);
    expect(body?.mimeType).toBe("text/html");
    expect(decode(body!.data)).toBe("<p>Hello <b>there</b></p>");
  });
  it("reads a single-part message whose root payload is the body", () => {
    expect(decode(findBodyPart(textPart("", "just text"))!.data)).toBe("just text");
  });
  it("never takes an attached text file as the body", () => {
    const notes: GmailPart = { partId: "0", mimeType: "text/plain", filename: "notes.txt", headers: [{ name: "Content-Disposition", value: 'attachment; filename="notes.txt"' }], body: { size: 9, data: b64url("not body!") } };
    const unnamed: GmailPart = { partId: "1", mimeType: "text/plain", filename: "", headers: [{ name: "Content-Disposition", value: "attachment" }], body: { size: 4, data: b64url("nope") } };
    const payload = multipart("", "mixed", [notes, unnamed, multipart("2", "alternative", [textPart("2.0", "the real body")])]);
    expect(decode(findBodyPart(payload)!.data)).toBe("the real body");
  });
  it("returns null when there is no body part at all", () => {
    expect(findBodyPart({ headers: [{ name: "From", value: "a@b.com" }] })).toBeNull();
    expect(findBodyPart(undefined)).toBeNull();
  });
});

describe("attachmentsFromPayload", () => {
  it("lists files at any depth with part id, attachment id, type, size and disposition", () => {
    const payload = multipart("", "mixed", [
      multipart("0", "alternative", [textPart("0.0", "hi"), textPart("0.1", "<p>hi</p>", "text/html")]),
      filePart("1", "invoice.pdf", "application/pdf", 120 * KB),
      multipart("2", "mixed", [filePart("2.0", "contract.docx", WORD, 45 * KB)]),
    ]);
    expect(attachmentsFromPayload(payload)).toEqual([
      { partId: "1", attachmentId: "att-1", filename: "invoice.pdf", mimeType: "application/pdf", size: 120 * KB, inline: false },
      { partId: "2.0", attachmentId: "att-2.0", filename: "contract.docx", mimeType: WORD, size: 45 * KB, inline: false },
    ]);
  });
  it("drops a 1 KB tracking pixel but KEEPS a large inline infographic, named by its part id", () => {
    const payload = multipart("", "related", [
      textPart("0", "<img src='cid:img-1@mail'>", "text/html"),
      inlineImage("1", "image/png", 340 * KB),
      inlineImage("2", "image/gif", 1 * KB),
    ]);
    expect(attachmentsFromPayload(payload)).toEqual([
      { partId: "1", attachmentId: "att-1", filename: "image-1.png", mimeType: "image/png", size: 340 * KB, inline: true },
    ]);
  });
  it("drops every image under 20 KB however it is attached, and keeps one at exactly 20 KB", () => {
    const payload = multipart("", "mixed", [
      textPart("0", "hi"),
      filePart("1", "logo.png", "image/png", 5 * KB), // a named, attached icon is still noise
      inlineImage("2", "image/jpeg", MIN_IMAGE_BYTES - 1),
      inlineImage("3", "image/jpeg", MIN_IMAGE_BYTES),
    ]);
    expect(names(attachmentsFromPayload(payload))).toEqual(["image-3.jpg"]);
  });
  it("keeps every slice of a sliced newsletter and drops only its tracking pixel", () => {
    const meta = attachmentsFromPayload(slicedNewsletter("n1", 12).payload);
    expect(meta).toHaveLength(12);
    expect(meta.every(a => a.mimeType === "image/png" && a.inline)).toBe(true);
  });
  it("never counts text bodies, and leaves attachmentId off a part whose bytes came inline", () => {
    const payload = multipart("", "related", [textPart("0", "hi"), textPart("1", "<p>hi</p>", "text/html"), inlineImage("2", "image/png", 25 * KB, { data: b64url("PNG") })]);
    expect(attachmentsFromPayload(payload)).toEqual([{ partId: "2", filename: "image-2.png", mimeType: "image/png", size: 25 * KB, inline: true }]);
  });
  it("types a generically-labelled file by its extension, and normalizes image/jpg", () => {
    const payload = multipart("", "mixed", [
      textPart("0", "hi"),
      filePart("1", "Statement.PDF", "application/octet-stream", 80 * KB),
      filePart("2", "photo.jpg", "image/jpg", 500 * KB),
      filePart("3", "blob.bin", "application/octet-stream", 3 * KB),
    ]);
    expect(attachmentsFromPayload(payload).map(a => a.mimeType)).toEqual(["application/pdf", "image/jpeg", "application/octet-stream"]);
  });
  it("flattens an untrusted file name to one bounded line", () => {
    const payload = multipart("", "mixed", [textPart("0", "hi"), filePart("1", `URGENT\r\ninvoice${"x".repeat(300)}.pdf`, "application/pdf", 10 * KB)]);
    const [a] = attachmentsFromPayload(payload);
    expect(a!.filename.startsWith("URGENT invoice")).toBe(true);
    expect(a!.filename).not.toMatch(/[\r\n]/);
    expect(a!.filename.length).toBeLessThanOrEqual(120);
  });
  it("returns [] for a header-only payload", () => {
    expect(attachmentsFromPayload({ headers: [{ name: "From", value: "a@b.com" }] })).toEqual([]);
    expect(attachmentsFromPayload(undefined)).toEqual([]);
  });
});

describe("isReadable", () => {
  it("reads PDFs, PNG/JPEG/WEBP/HEIC/HEIF images and text/CSV — nothing else", () => {
    expect([...READABLE_MIME_TYPES].sort()).toEqual(["application/pdf", "image/heic", "image/heif", "image/jpeg", "image/png", "image/webp", "text/csv", "text/plain"]);
    for (const m of READABLE_MIME_TYPES) expect(isReadable(att("f", m, 1))).toBe(true);
    for (const m of [WORD, "application/zip", "image/gif", "text/html", "application/octet-stream"]) expect(isReadable(att("f", m, 1))).toBe(false);
  });
});

describe("attachmentLine", () => {
  it("is empty when there are none", () => {
    expect(attachmentLine([])).toBe("");
  });
  it("names documents with type and size, and counts the images (the spec's example)", () => {
    expect(attachmentLine([att("invoice.pdf", "application/pdf", 120 * KB), att("contract.docx", WORD, 45 * KB), att("a.png", "image/png", 30 * KB), att("b.jpg", "image/jpeg", 40 * KB), att("c.png", "image/png", 50 * KB)]))
      .toBe("invoice.pdf (PDF, 120 KB), contract.docx (Word, 45 KB) + 3 images");
  });
  it("names at most 5 documents, then +N more", () => {
    const seven = Array.from({ length: 7 }, (_, i) => att(`f${i + 1}.pdf`, "application/pdf", 1 * KB));
    const five = "f1.pdf (PDF, 1 KB), f2.pdf (PDF, 1 KB), f3.pdf (PDF, 1 KB), f4.pdf (PDF, 1 KB), f5.pdf (PDF, 1 KB)";
    expect(attachmentLine(seven)).toBe(`${five} +2 more`);
    expect(attachmentLine([...seven, att("x.png", "image/png", 30 * KB)])).toBe(`${five} +2 more + 1 image`);
  });
  it("names the largest image when images are the only content", () => {
    expect(attachmentLine([att("image-1.png", "image/png", 30 * KB), att("infographic.png", "image/png", 340 * KB), att("image-3.png", "image/png", 25 * KB)]))
      .toBe("infographic.png (PNG image, 340 KB) + 2 more images");
    expect(attachmentLine([att("scan.jpg", "image/jpeg", 2.5 * MB)])).toBe("scan.jpg (JPG image, 2.5 MB)");
  });
  it("labels other types by extension, and rounds a tiny file up to 1 KB", () => {
    expect(attachmentLine([att("data.xyz", "application/x-thing", 100), att("sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 9 * KB), att("notes", "application/x-thing", 2 * KB)]))
      .toBe("data.xyz (XYZ, 1 KB), sheet.xlsx (Excel, 9 KB), notes (file, 2 KB)");
  });
});

describe("prioritize", () => {
  it("puts readable documents first, then readable images largest first, then the rest", () => {
    const list = [att("photo.gif", "image/gif", 500 * KB), att("small.png", "image/png", 30 * KB), att("terms.docx", WORD, 45 * KB), att("big.jpg", "image/jpeg", 900 * KB), att("invoice.pdf", "application/pdf", 120 * KB), att("data.csv", "text/csv", 2 * KB)];
    expect(names(prioritize(list))).toEqual(["invoice.pdf", "data.csv", "big.jpg", "small.png", "photo.gif", "terms.docx"]);
  });
});

describe("selectForReading", () => {
  const caps = { maxFiles: MAX_READ_FILES_PER_EMAIL, maxBytes: MAX_READ_BYTES_PER_EMAIL };
  it("reads at most 7 files of a sliced newsletter — the 7 largest slices", () => {
    const { selected, skipped } = selectForReading(attachmentsFromPayload(slicedNewsletter("n1", 12).payload), caps);
    expect(names(selected)).toEqual(["image-12.png", "image-11.png", "image-10.png", "image-9.png", "image-8.png", "image-7.png", "image-6.png"]);
    expect(skipped.map(s => s.reason)).toEqual(["cap", "cap", "cap", "cap", "cap"]);
  });
  it("keeps one email's reads within 20 MB, and refuses a single file over it as too large", () => {
    const { selected, skipped } = selectForReading([att("a.pdf", "application/pdf", 12 * MB), att("b.pdf", "application/pdf", 12 * MB), att("huge.pdf", "application/pdf", 25 * MB), att("c.pdf", "application/pdf", 5 * MB)], caps);
    expect(names(selected)).toEqual(["a.pdf", "c.pdf"]);
    expect(skipped.map(s => [s.attachment.filename, s.reason])).toEqual([["b.pdf", "cap"], ["huge.pdf", "too-large"]]);
  });
  it("lists a type it can't open as unreadable, and reads documents ahead of images", () => {
    const { selected, skipped } = selectForReading([att("x.png", "image/png", 30 * KB), att("terms.docx", WORD, 45 * KB), att("invoice.pdf", "application/pdf", 1 * KB)], caps);
    expect(names(selected)).toEqual(["invoice.pdf", "x.png"]);
    expect(skipped.map(s => [s.attachment.filename, s.reason])).toEqual([["terms.docx", "unreadable"]]);
  });
});

describe("findPart and base64UrlToBase64", () => {
  it("finds a part by its id at any depth, the root included", () => {
    const payload = multipart("", "mixed", [multipart("0", "alternative", [textPart("0.0", "hi")]), filePart("1", "a.pdf", "application/pdf", 1)]);
    expect(findPart(payload, "0.0")?.mimeType).toBe("text/plain");
    expect(findPart(payload, "")?.mimeType).toBe("multipart/mixed");
    expect(findPart(payload, "9")).toBeUndefined();
  });
  it("turns Gmail's base64url into the standard base64 Gemini wants", () => {
    expect(base64UrlToBase64("-_8")).toBe("+/8=");
    expect(Buffer.from(base64UrlToBase64(b64url("Invoice 4821")), "base64").toString("utf8")).toBe("Invoice 4821");
  });
});
