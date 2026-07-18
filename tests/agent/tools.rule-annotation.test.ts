import { describe, it, expect } from "vitest";
import { readOnlyTools } from "../../src/agent/tools.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeGmailClient } from "../../src/gmail/client.js";

const tool = (name: string) => readOnlyTools().find(t => t.schema.name === name)!;

function ctx() {
  const memory = inMemoryStore();
  // a domain trash rule for shop.com; jane@x.com is left un-ruled
  memory.upsertRule({ matchValue: "shop.com", scope: "domain", verdict: "unimportant", description: "shop", action: "trash" });
  const gmail = fakeGmailClient({
    historyId: "1", addedSince: {},
    messages: {
      a: { id: "a", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "promo@shop.com" }, { name: "Subject", value: "Sale" }] } },
      b: { id: "b", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "jane@x.com" }, { name: "Subject", value: "Lunch" }] } },
    },
    searchResults: { "in:inbox from:test": ["a", "b"] }, // scopeSearchToInbox prefixes in:inbox
    bodies: { a: "buy now", b: "hi" },
  });
  return { userId: 1, memory, gmail } as any;
}

describe("search_gmail rule annotation", () => {
  it("tags a ruled sender with its rule kind and leaves an un-ruled sender null, preserving other fields", async () => {
    const res = await tool("search_gmail").run({ query: "from:test" }, ctx()) as any[];
    const byEmail = Object.fromEntries(res.map(r => [r.fromEmail, r]));
    expect(byEmail["promo@shop.com"].rule).toEqual({ kind: "auto-trash", scope: "domain", matchValue: "shop.com" });
    expect(byEmail["jane@x.com"].rule).toBeNull();
    expect(byEmail["promo@shop.com"].subject).toBe("Sale"); // existing fields intact
  });
});

describe("read_messages rule annotation", () => {
  it("tags each read message by its sender's rule, preserving id/body", async () => {
    const res = await tool("read_messages").run({ ids: ["a", "b"] }, ctx()) as any[];
    const a = res.find(r => r.id === "a"); const b = res.find(r => r.id === "b");
    expect(a.rule).toEqual({ kind: "auto-trash", scope: "domain", matchValue: "shop.com" });
    expect(a.bodyText).toBe("buy now");
    expect(b.rule).toBeNull();
  });
});
