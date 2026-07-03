import { describe, it, expect } from "vitest";
import { fakeGmailClient } from "../../src/gmail/client.js";

describe("fakeGmailClient countMessages", () => {
  it("returns the number of matching message ids for a query", async () => {
    const g = fakeGmailClient({
      historyId: "1",
      addedSince: {},
      messages: {},
      searchResults: { "in:inbox": ["a", "b", "c"] },
    });
    expect(await g.countMessages("in:inbox")).toBe(3);
  });

  it("returns 0 for a query with no matches", async () => {
    const g = fakeGmailClient({
      historyId: "1",
      addedSince: {},
      messages: {},
      searchResults: {},
    });
    expect(await g.countMessages("from:nobody.example")).toBe(0);
  });

  it("search still returns resolved metas (default max unaffected in fake)", async () => {
    const g = fakeGmailClient({
      historyId: "1",
      addedSince: {},
      messages: { a: { id: "a", threadId: "t", snippet: "s", payload: { headers: [{ name: "From", value: "x@y.com" }] } } },
      searchResults: { "from:linkedin.com": ["a"] },
    });
    const found = await g.search("from:linkedin.com");
    expect(found.map(m => m.id)).toEqual(["a"]);
  });
});
