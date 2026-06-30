import { describe, it, expect } from "vitest";
import { parseMessage } from "../../src/gmail/headers.js";

const raw = {
  id: "m1", threadId: "t1", snippet: "hi there",
  payload: { headers: [
    { name: "From", value: "Jane Doe <jane@Example.com>" },
    { name: "Subject", value: "Lunch?" },
    { name: "Date", value: "Tue, 30 Jun 2026 10:00:00 +0000" },
  ]},
};

describe("parseMessage", () => {
  it("extracts and lowercases the sender address + domain", () => {
    const m = parseMessage(raw);
    expect(m.fromEmail).toBe("jane@example.com");
    expect(m.fromDomain).toBe("example.com");
    expect(m.subject).toBe("Lunch?");
    expect(m.headers["from"]).toContain("jane");
  });
  it("falls back to empty subject and bare address forms", () => {
    const m = parseMessage({ id:"m2", threadId:"t2", snippet:"", payload:{ headers:[
      { name:"From", value:"bare@host.io" }]}});
    expect(m.fromEmail).toBe("bare@host.io");
    expect(m.subject).toBe("");
  });
});
