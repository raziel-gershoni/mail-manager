// tests/telegram/conversation.test.ts
import { describe, it, expect } from "vitest";
import { handleMessage, type SecretaryDeps } from "../../src/telegram/bot.js";
import { fakeConversationRepo } from "../../src/conversation/store.js";
import { fakeAgentLLM } from "../../src/llm/provider.js";
import { readOnlyTools } from "../../src/agent/tools.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";

function deps(script: any): SecretaryDeps {
  return {
    userId: 1, memory: inMemoryStore(), convo: fakeConversationRepo(),
    gmail: fakeGmailClient({ historyId: "1", addedSince: {}, messages: {}, searchResults: {}, bodies: {} }),
    llm: fakeAgentLLM(script), tools: readOnlyTools(),
  };
}

describe("handleMessage", () => {
  it("runs an agent turn and persists user + assistant turns", async () => {
    const d = deps(() => ({ kind: "final", text: "Noted." }));
    const reply = await handleMessage("dana is always important", d);
    expect(reply).toBe("Noted.");
    const state = await d.convo.load(1);
    expect(state.window.map(t => t.role)).toEqual(["user", "assistant"]);
    expect(state.window[0]!.content).toBe("dana is always important");
  });
  it("a learned rule via write_memory persists to the shared store", async () => {
    let n = 0;
    const d = deps(() => (n++ === 0
      ? { kind: "tool_calls", calls: [{ name: "write_memory", args: { matchValue: "dana@x.com", scope: "sender", verdict: "important", description: "dana important" } }] }
      : { kind: "final", text: "Got it." }));
    await handleMessage("dana@x.com is important", d);
    expect(d.memory.findRuleFor("dana@x.com", "x.com")?.verdict).toBe("important");
  });
});
