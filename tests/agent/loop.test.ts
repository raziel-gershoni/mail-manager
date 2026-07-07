import { describe, it, expect, vi } from "vitest";
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
    expect(res.text).toMatch(/narrow it down/i);
  });
  it("appends assistant turn before tool results", async () => {
    const seen: any[][] = [];
    let n = 0;
    const llm = fakeAgentLLM((messages) => {
      seen.push(messages);
      return n++ === 0
        ? { kind: "tool_calls", calls: [{ name: "list_memories", args: {} }] }
        : { kind: "final", text: "done" };
    });
    await runAgentTurn([{ role: "user", content: "x" }], { llm, tools: readOnlyTools(), ctx: ctx() });
    const second = seen[1]!;
    const toolIdx = second.findIndex((m: any) => m.role === "tool");
    const asstIdx = second.findIndex((m: any) => m.role === "assistant");
    expect(asstIdx).toBeGreaterThanOrEqual(0);
    expect(asstIdx).toBeLessThan(toolIdx);
  });
  it("forces a final answer after exhausting tool rounds (no canned apology)", async () => {
    let n = 0;
    const llm = fakeAgentLLM(() => {
      n++;
      return n <= 3
        ? { kind: "tool_calls", calls: [{ name: "list_memories", args: {} }] }
        : { kind: "final", text: "here you go" };
    });
    const res = await runAgentTurn([{ role: "user", content: "x" }], { llm, tools: readOnlyTools(), ctx: ctx(), maxIters: 3 });
    expect(res.text).toBe("here you go");
  });
  it("respects a wall-clock budget: stops planning and force-finals with a tool-free call", async () => {
    // schemas empty on the forced call → the model must produce a final answer
    const llm = { agentStep: (_msgs: unknown, schemas: unknown[]) =>
      Array.isArray(schemas) && schemas.length === 0
        ? Promise.resolve({ kind: "final", text: "best effort" })
        : Promise.resolve({ kind: "tool_calls", calls: [{ name: "list_memories", args: {} }] }) } as unknown as import("../../src/llm/provider.js").LLMProvider;
    const res = await runAgentTurn([{ role: "user", content: "x" }], { llm, tools: readOnlyTools(), ctx: ctx(), maxIters: 5, budgetMs: 30 });
    expect(res.text).toBe("best effort"); // budget (30ms) exhausted immediately → forced final answer, not the apology
  });
  it("recovers when a planning call throws (e.g. Gemini 504): forces a final answer instead of propagating the error", async () => {
    // The tool-planning call rejects (504); the tool-free forced-final call succeeds.
    const llm = { agentStep: (_msgs: unknown, schemas: unknown[]) =>
      Array.isArray(schemas) && schemas.length === 0
        ? Promise.resolve({ kind: "final", text: "best effort after error" })
        : Promise.reject(new Error("504 DEADLINE_EXCEEDED")) } as unknown as import("../../src/llm/provider.js").LLMProvider;
    const res = await runAgentTurn([{ role: "user", content: "audit rules" }], { llm, tools: readOnlyTools(), ctx: ctx() });
    expect(res.text).toBe("best effort after error"); // did NOT throw; fell through to the forced final
  });
  it("never throws to the caller when EVERY model call errors: returns the safety-net reply", async () => {
    // Persistent 504 on both the planning call and the forced-final → the owner still gets a message.
    const llm = { agentStep: () => Promise.reject(new Error("504 DEADLINE_EXCEEDED")) } as unknown as import("../../src/llm/provider.js").LLMProvider;
    const res = await runAgentTurn([{ role: "user", content: "audit rules" }], { llm, tools: readOnlyTools(), ctx: ctx() });
    expect(res.text).toMatch(/ran out of time|narrow it down/i); // safety-net message, not a thrown error
  });
  it("returns the safety-net reply in the user's language (he)", async () => {
    const llm = { agentStep: () => Promise.reject(new Error("504")) } as unknown as import("../../src/llm/provider.js").LLMProvider;
    const res = await runAgentTurn([{ role: "user", content: "x" }], { llm, tools: readOnlyTools(), ctx: ctx(), language: "he" });
    expect(res.text).toMatch(/נגמר לי הזמן/); // Hebrew safety-net
  });
  it("emits structured logs for tool calls and the final", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      let calls = 0;
      const llm = fakeAgentLLM(() => {
        calls++;
        return calls === 1
          ? { kind: "tool_calls", calls: [{ name: "list_memories", args: {} }] }
          : { kind: "final", text: "done" };
      });
      await runAgentTurn([{ role: "user", content: "x" }], { llm, tools: readOnlyTools(), ctx: ctx() });
      const events = spy.mock.calls.map(c => { try { return (JSON.parse(c[0] as string) as { event: string }).event; } catch { return null; } });
      expect(events).toContain("agent.tool");
      expect(events).toContain("agent.final");
    } finally { spy.mockRestore(); }
  });
});
