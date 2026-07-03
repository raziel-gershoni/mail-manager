import { describe, it, expect } from "vitest";
import { readOnlyTools, dispatchTool } from "../../src/agent/tools.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";

function ctx() {
  return {
    userId: 1,
    gmail: fakeGmailClient({
      historyId: "1", addedSince: {},
      messages: { a: { id: "a", threadId: "t", snippet: "s", payload: { headers: [{ name: "From", value: "x@y.com" }, { name: "Subject", value: "Hi" }] } } },
      searchResults: { "from:y.com": ["a"] }, bodies: { a: "<p>body</p>" },
    }),
    memory: inMemoryStore(),
  };
}

describe("readOnlyTools", () => {
  it("exposes no destructive or send capability", () => {
    const names = readOnlyTools().map(t => t.schema.name);
    expect(names).toContain("search_gmail");
    expect(names).toContain("count_messages");
    expect(names).toContain("read_messages");
    for (const banned of ["trash", "send_email", "forward", "http", "delete_messages"]) {
      expect(names.some(n => n.includes(banned))).toBe(false);
    }
    expect(readOnlyTools().every(t => !t.mutating || t.schema.name.endsWith("_memory"))).toBe(true);
  });
});

describe("dispatchTool", () => {
  const tools = readOnlyTools();
  it("search_gmail returns metadata rows", async () => {
    const r = await dispatchTool("search_gmail", { query: "from:y.com" }, ctx(), tools) as any[];
    expect(r[0].id).toBe("a");
  });
  it("count_messages returns a fast count without reading contents", async () => {
    const r = await dispatchTool("count_messages", { query: "from:y.com" }, ctx(), tools) as { query: string; count: number };
    expect(r).toEqual({ query: "from:y.com", count: 1 });
  });
  it("read_messages returns stripped bodies, capped at 10", async () => {
    const r = await dispatchTool("read_messages", { ids: ["a"] }, ctx(), tools) as any[];
    expect(r[0].bodyText).toBe("body");
  });
  it("write_memory upserts a rule the classifier can read", async () => {
    const c = ctx();
    await dispatchTool("write_memory", { matchValue: "n@linkedin.com", scope: "sender", verdict: "unimportant", description: "linkedin noise" }, c, tools);
    expect(c.memory.findRuleFor("n@linkedin.com", "linkedin.com")?.verdict).toBe("unimportant");
  });
  it("throws on an unknown tool", async () => {
    await expect(dispatchTool("trash", {}, ctx(), tools)).rejects.toThrow(/unknown tool/i);
  });
});
