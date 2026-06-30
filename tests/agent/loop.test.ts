import { describe, it, expect } from "vitest";
import { runAgentTurn } from "../../src/agent/loop.js";
import { fakeAgentLLM } from "../../src/llm/provider.js";
import { readOnlyTools, type ToolContext } from "../../src/agent/tools.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";

function ctx(): ToolContext {
  return { userId: 1, memory: inMemoryStore(),
    gmail: fakeGmailClient({ historyId: "1", addedSince: {},
      messages: { a: { id: "a", threadId: "t", snippet: "s", payload: { headers: [{ name: "From", value: "x@y.com" }] } } },
      searchResults: { "from:y.com": ["a"] }, bodies: { a: "hi" } }) };
}

describe("runAgentTurn", () => {
  it("runs a tool call then returns the final text + tool note", async () => {
    let calls = 0;
    const llm = fakeAgentLLM(() => {
      calls++;
      return calls === 1
        ? { kind: "tool_calls", calls: [{ name: "search_gmail", args: { query: "from:y.com" } }] }
        : { kind: "final", text: "You have 1 from x@y.com." };
    });
    const res = await runAgentTurn([{ role: "user", content: "any mail from y?" }], { llm, tools: readOnlyTools(), ctx: ctx() });
    expect(res.text).toBe("You have 1 from x@y.com.");
    expect(res.toolNote).toContain("search_gmail");
  });
  it("stops at maxIters without a final", async () => {
    const llm = fakeAgentLLM(() => ({ kind: "tool_calls", calls: [{ name: "list_memories", args: {} }] }));
    const res = await runAgentTurn([{ role: "user", content: "loop" }], { llm, tools: readOnlyTools(), ctx: ctx(), maxIters: 3 });
    expect(res.text).toMatch(/couldn't complete|stopped/i);
  });
});
