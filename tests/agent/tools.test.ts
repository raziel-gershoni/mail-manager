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
      // count_messages passes the query through as-is; search_gmail scopes it to the inbox
      searchResults: { "from:y.com": ["a"], "in:inbox from:y.com": ["a"] }, bodies: { a: "<p>body</p>" },
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
  it("count_messages counts a batch of queries in one call, order preserved", async () => {
    const c = {
      userId: 1,
      gmail: fakeGmailClient({
        historyId: "1", addedSince: {}, messages: {},
        searchResults: { "in:anywhere from:a.com": ["1", "2"], "in:anywhere from:b.com": [] },
      }),
      memory: inMemoryStore(),
    };
    const r = await dispatchTool("count_messages", { queries: ["in:anywhere from:a.com", "in:anywhere from:b.com"] }, c, tools) as { counts: { query: string; count: number }[] };
    expect(r.counts).toEqual([
      { query: "in:anywhere from:a.com", count: 2 },
      { query: "in:anywhere from:b.com", count: 0 },
    ]);
  });
  it("list_memories exposes each rule's scope, matchValue, verdict, and action", async () => {
    const c = ctx();
    c.memory.upsertRule({ matchValue: "linkedin.com", scope: "domain", verdict: "unimportant", description: "li noise", action: "trash" });
    const r = await dispatchTool("list_memories", {}, c, tools) as Array<Record<string, unknown>>;
    expect(r[0]).toEqual({ slug: "domain:linkedin.com", scope: "domain", matchValue: "linkedin.com", verdict: "unimportant", action: "trash", description: "li noise" });
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
  it("write_memory accepts a guarded-trash (review) action", async () => {
    const c = ctx();
    await dispatchTool("write_memory", { matchValue: "shop.com", scope: "domain", verdict: "unimportant", description: "guard shop", action: "review" }, c, tools);
    expect(c.memory.findRuleFor("x@shop.com", "shop.com")?.action).toBe("review");
  });
  it("write_memory accepts a guarded-archive (review_archive) action", async () => {
    const c = ctx();
    await dispatchTool("write_memory", { matchValue: "list.com", scope: "domain", verdict: "unimportant", description: "guard-archive list", action: "review_archive" }, c, tools);
    expect(c.memory.findRuleFor("x@list.com", "list.com")?.action).toBe("review_archive");
  });
  it("write_memory accepts a keep action (leave in inbox, stop asking)", async () => {
    const c = ctx();
    await dispatchTool("write_memory", { matchValue: "keepme.com", scope: "domain", verdict: "unimportant", description: "leave it", action: "keep" }, c, tools);
    expect(c.memory.findRuleFor("x@keepme.com", "keepme.com")?.action).toBe("keep");
  });
  it("throws on an unknown tool", async () => {
    await expect(dispatchTool("trash", {}, ctx(), tools)).rejects.toThrow(/unknown tool/i);
  });
});
