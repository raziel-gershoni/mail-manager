// tests/queue/failure.test.ts
import { describe, it, expect } from "vitest";
import { parseFailureBody } from "../../src/queue/failure.js";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

// What QStash POSTs to failureCallback after it gives up: the original request
// body comes back base64-encoded in sourceBody.
const payload = (update: unknown) => ({
  status: 500,
  retried: 3,
  maxRetries: 3,
  sourceMessageId: "msg_123",
  url: "https://app/api/worker",
  sourceBody: b64(update),
});

const update = { update_id: 77, message: { chat: { id: 555 }, from: { id: 999 }, text: "clean my junk" } };

describe("parseFailureBody", () => {
  it("recovers who to apologise to from the original request", () => {
    expect(parseFailureBody(payload(update))).toEqual({ chatId: 555, fromId: 999, updateId: 77 });
  });

  it("returns null when sourceBody is missing", () => {
    expect(parseFailureBody({ status: 500 })).toBeNull();
  });

  it("returns null when sourceBody is not base64 JSON", () => {
    expect(parseFailureBody({ sourceBody: "!!!not base64 json!!!" })).toBeNull();
  });

  it("returns null when the update has no chat to reply to", () => {
    expect(parseFailureBody(payload({ update_id: 1, edited_message: {} }))).toBeNull();
  });

  it("returns null for junk input", () => {
    expect(parseFailureBody(null)).toBeNull();
    expect(parseFailureBody("nope")).toBeNull();
    expect(parseFailureBody(42)).toBeNull();
  });

  it("tolerates an update with no from id", () => {
    expect(parseFailureBody(payload({ message: { chat: { id: 5 } } }))).toEqual({ chatId: 5, fromId: undefined, updateId: undefined });
  });
});
