// tests/agent/loop.stream.test.ts
import { describe, it, expect } from "vitest";
import { runAgentTurn } from "../../src/agent/loop.js";
import { fakeAgentLLM, type StreamSink } from "../../src/llm/provider.js";
import { readOnlyTools, type ToolContext } from "../../src/agent/tools.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";

function ctx(): ToolContext {
  return { userId: 1, memory: inMemoryStore(),
    gmail: fakeGmailClient({ historyId: "1", addedSince: {}, messages: {}, bodies: {} }) };
}

const noopSink: StreamSink = { onText: () => {}, onToolCall: () => {} };

describe("runAgentTurn streaming", () => {
  it("hands the sink to every model call so the answer can stream", async () => {
    const seen: (StreamSink | undefined)[] = [];
    let calls = 0;
    const llm = fakeAgentLLM((_m, _t, sink) => {
      seen.push(sink);
      calls++;
      return calls === 1
        ? { kind: "tool_calls", calls: [{ name: "list_memories", args: {} }] }
        : { kind: "final", text: "done" };
    });
    const res = await runAgentTurn([{ role: "user", content: "hi" }], { llm, tools: readOnlyTools(), ctx: ctx(), sink: noopSink });
    expect(res.text).toBe("done");
    expect(seen).toEqual([noopSink, noopSink]); // the tool round AND the answering round
  });

  it("still streams on the forced-final path, so an exhausted turn is not silent", async () => {
    // Every step asks for a tool, so the loop runs out of iterations and falls
    // through to the bounded forced-final call — the owner's answer comes from
    // THAT call, so it has to stream too.
    const seen: (StreamSink | undefined)[] = [];
    let calls = 0;
    const llm = fakeAgentLLM((_m, tools, sink) => {
      seen.push(sink);
      calls++;
      // The forced-final call is the one made with no tools available.
      if (tools.length === 0) return { kind: "final", text: "best effort" };
      return { kind: "tool_calls", calls: [{ name: "list_memories", args: {} }] };
    });
    const res = await runAgentTurn([{ role: "user", content: "hi" }], { llm, tools: readOnlyTools(), ctx: ctx(), maxIters: 2, sink: noopSink });
    expect(res.text).toBe("best effort");
    expect(calls).toBe(3);                       // 2 tool rounds + the forced final
    expect(seen.every(s => s === noopSink)).toBe(true);
  });

  it("works with no sink at all (the poll and tests call it that way)", async () => {
    const llm = fakeAgentLLM((_m, _t, sink) => {
      expect(sink).toBeUndefined();
      return { kind: "final", text: "plain" };
    });
    const res = await runAgentTurn([{ role: "user", content: "hi" }], { llm, tools: readOnlyTools(), ctx: ctx() });
    expect(res.text).toBe("plain");
  });
});
