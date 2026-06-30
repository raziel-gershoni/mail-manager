import { describe, it, expect } from "vitest";
import { toGeminiContents } from "../../src/llm/gemini.js";
import type { AgentMessage } from "../../src/context/assemble.js";

describe("toGeminiContents", () => {
  it("collects system messages into systemInstruction", () => {
    const out = toGeminiContents([
      { role: "system", content: "rule A" },
      { role: "system", content: "rule B" },
    ]);
    expect(out.systemInstruction).toBe("rule A\n\nrule B");
    expect(out.contents).toEqual([]);
  });

  it("maps a user text to a user/text part", () => {
    const out = toGeminiContents([{ role: "user", content: "hi" }]);
    expect(out.systemInstruction).toBeUndefined();
    expect(out.contents).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
  });

  it("maps an assistant-content to model/text", () => {
    const out = toGeminiContents([{ role: "assistant", content: "hello" }]);
    expect(out.contents).toEqual([{ role: "model", parts: [{ text: "hello" }] }]);
  });

  it("maps assistant-toolCalls to model with functionCall parts", () => {
    const msgs: AgentMessage[] = [
      { role: "assistant", toolCalls: [{ name: "search_gmail", args: { query: "x" } }] },
    ];
    const out = toGeminiContents(msgs);
    expect(out.contents).toEqual([
      { role: "model", parts: [{ functionCall: { name: "search_gmail", args: { query: "x" } } }] },
    ]);
  });

  it("maps a tool object result to user with a functionResponse part", () => {
    const out = toGeminiContents([{ role: "tool", name: "search_gmail", result: { count: 2 } }]);
    expect(out.contents).toEqual([
      { role: "user", parts: [{ functionResponse: { name: "search_gmail", response: { count: 2 } } }] },
    ]);
  });

  it("wraps a non-object (array) tool result in { result }", () => {
    const out = toGeminiContents([{ role: "tool", name: "list", result: [1, 2, 3] }]);
    expect(out.contents).toEqual([
      { role: "user", parts: [{ functionResponse: { name: "list", response: { result: [1, 2, 3] } } }] },
    ]);
  });

  it("truncates an oversized tool result", () => {
    const big = { blob: "x".repeat(50_000) };
    const out = toGeminiContents([{ role: "tool", name: "big", result: big }]);
    const part = out.contents[0]!.parts[0] as { functionResponse: { response: { result: string } } };
    expect(typeof part.functionResponse.response.result).toBe("string");
    expect(part.functionResponse.response.result.length).toBe(40_000);
  });
});
