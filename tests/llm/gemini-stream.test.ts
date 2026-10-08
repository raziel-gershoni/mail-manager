// tests/llm/gemini-stream.test.ts
import { describe, it, expect } from "vitest";
import { consumeAgentStream } from "../../src/llm/gemini.js";
import type { StreamSink } from "../../src/llm/provider.js";

function recorder() {
  const text: string[] = [];
  let toolCalls = 0;
  const sink: StreamSink = { onText: d => { text.push(d); }, onToolCall: () => { toolCalls++; } };
  return { sink, text, calls: () => toolCalls };
}

// Shape a chunk the way Gemini streams one: candidates[0].content.parts[]
const chunk = (...parts: unknown[]) => ({ candidates: [{ content: { parts } }] });

async function* streamOf(...chunks: unknown[]) {
  for (const c of chunks) yield c as never;
}

describe("consumeAgentStream", () => {
  it("forwards text deltas in order and returns the whole answer", async () => {
    const r = recorder();
    const step = await consumeAgentStream(streamOf(chunk({ text: "Two things" }), chunk({ text: " from the bank" })), r.sink);
    expect(r.text).toEqual(["Two things", " from the bank"]);
    expect(step).toEqual({ kind: "final", text: "Two things from the bank" });
  });

  it("never streams the model's reasoning to the owner", async () => {
    const r = recorder();
    const step = await consumeAgentStream(streamOf(
      chunk({ text: "let me check the bank sender first", thought: true }),
      chunk({ text: "Two things" }),
    ), r.sink);
    expect(r.text).toEqual(["Two things"]);            // the thought never reaches the chat
    expect(step).toEqual({ kind: "final", text: "Two things" });
  });

  it("reports a tool call once and preserves its thoughtSignature", async () => {
    const r = recorder();
    const step = await consumeAgentStream(streamOf(
      chunk({ functionCall: { name: "search_gmail", args: { q: "bank" } }, thoughtSignature: "sig-1" }),
      chunk({ functionCall: { name: "read_messages", args: { ids: ["a"] } } }),
    ), r.sink);
    expect(r.calls()).toBe(1);                          // once per step, not once per call
    expect(step).toEqual({ kind: "tool_calls", calls: [
      { name: "search_gmail", args: { q: "bank" }, thoughtSignature: "sig-1" },
      { name: "read_messages", args: { ids: ["a"] }, thoughtSignature: undefined },
    ] });
  });

  it("keeps each streamed call's id", async () => {
    const step = await consumeAgentStream(streamOf(
      chunk({ functionCall: { id: "call_1", name: "search_gmail", args: { q: "bank" } }, thoughtSignature: "sig-1" }),
      chunk({ functionCall: { id: "call_2", name: "read_messages", args: { ids: ["a"] } } }),
    ));
    expect(step.kind === "tool_calls" && step.calls.map(c => c.id)).toEqual(["call_1", "call_2"]);
  });

  it("stops streaming text once the step turns out to be a tool call", async () => {
    const r = recorder();
    await consumeAgentStream(streamOf(
      chunk({ text: "Let me look" }),
      chunk({ functionCall: { name: "search_gmail", args: {} } }),
      chunk({ text: "ignored trailing prose" }),
    ), r.sink);
    expect(r.text).toEqual(["Let me look"]); // the sink deletes this; nothing more is pushed
    expect(r.calls()).toBe(1);
  });

  it("keeps a truncated answer when the stream dies mid-flight", async () => {
    const r = recorder();
    async function* dying() {
      yield chunk({ text: "Two things from" }) as never;
      throw new Error("stream reset");
    }
    const step = await consumeAgentStream(dying(), r.sink);
    expect(step).toEqual({ kind: "final", text: "Two things from" }); // salvaged, not lost
  });

  it("rethrows when the stream dies before producing anything, so the caller can fall back", async () => {
    async function* deadOnArrival(): AsyncGenerator<never> { throw new Error("503"); }
    await expect(consumeAgentStream(deadOnArrival())).rejects.toThrow("503");
  });

  it("works without a sink", async () => {
    const step = await consumeAgentStream(streamOf(chunk({ text: "hi" })));
    expect(step).toEqual({ kind: "final", text: "hi" });
  });
});
