import { describe, it, expect } from "vitest";
import { fakeGmailClient } from "../../src/gmail/client.js";

describe("fakeGmailClient", () => {
  it("returns added ids since a history cursor and resolves metadata", async () => {
    const g = fakeGmailClient({
      historyId: "100",
      addedSince: { "90": ["a","b"] },
      messages: {
        a: { id:"a", threadId:"t", snippet:"", payload:{ headers:[{name:"From",value:"x@y.com"}] } },
        b: { id:"b", threadId:"t", snippet:"", payload:{ headers:[{name:"From",value:"z@y.com"}] } },
      },
    });
    expect(await g.currentHistoryId()).toBe("100");
    expect(await g.listAddedMessageIds("90")).toEqual(["a","b"]);
    expect((await g.getMeta("a")).fromEmail).toBe("x@y.com");
  });
});
