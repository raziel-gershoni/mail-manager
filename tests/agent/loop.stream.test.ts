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

function recorder() {
  const text: string[] = [];
  let toolCalls = 0;
  const sink: StreamSink = { onText: d => { text.push(d); }, onToolCall: () => { toolCalls++; } };
  return { sink, text, calls: () => toolCalls };
}

describe("runAgentTurn streaming", () => {
  it("streams from every model call, tool rounds and the answer alike", async () => {
    const r = recorder();
    let calls = 0;
    const llm = fakeAgentLLM((_m, _t, sink) => {
      calls++;
      if (calls === 1) {
        sink!.onText("let me look");   // prose before a tool call
        sink!.onToolCall();
        return { kind: "tool_calls", calls: [{ name: "list_memories", args: {} }] };
      }
      sink!.onText("You have no rules yet.");
      return { kind: "final", text: "You have no rules yet." };
    });
    const res = await runAgentTurn([{ role: "user", content: "hi" }], { llm, tools: readOnlyTools(), ctx: ctx(), sink: r.sink });
    expect(res.text).toBe("You have no rules yet.");
    expect(r.text).toEqual(["let me look", "You have no rules yet."]);
    expect(r.calls()).toBe(1);
  });

  it("still streams on the forced-final path, so an exhausted turn is not silent", async () => {
    // Every step asks for a tool, so the loop runs out of iterations and falls
    // through to the bounded forced-final call — the owner's answer comes from
    // THAT call, so it has to stream too.
    const r = recorder();
    const llm = fakeAgentLLM((_m, tools, sink) => {
      if (tools.length === 0) {           // the forced-final call has no tools
        sink!.onText("best effort");
        return { kind: "final", text: "best effort" };
      }
      return { kind: "tool_calls", calls: [{ name: "list_memories", args: {} }] };
    });
    const res = await runAgentTurn([{ role: "user", content: "hi" }], { llm, tools: readOnlyTools(), ctx: ctx(), maxIters: 2, sink: r.sink });
    expect(res.text).toBe("best effort");
    expect(r.text).toEqual(["best effort"]);
  });

  it("fences off a step that keeps streaming after it has already failed", async () => {
    // withTimeout abandons a slow call but the model keeps generating. Without a
    // per-step gate, that zombie stream would interleave its text with the
    // forced-final answer that replaced it — two answers in one message.
    const r = recorder();
    let zombie: ((d: string) => void) | undefined;
    const llm = fakeAgentLLM((_m, tools, sink) => {
      if (tools.length === 0) {
        sink!.onText("the real answer");
        return { kind: "final", text: "the real answer" };
      }
      sink!.onText("half a thought");
      zombie = d => sink!.onText(d);      // capture the handle the dead step held
      throw new Error("model blew up mid-stream");
    });
    const res = await runAgentTurn([{ role: "user", content: "hi" }], { llm, tools: readOnlyTools(), ctx: ctx(), sink: r.sink });
    zombie!("ZOMBIE TEXT");               // arrives after the step settled
    expect(res.text).toBe("the real answer");
    expect(r.text).toEqual(["half a thought", "the real answer"]); // no ZOMBIE TEXT
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
