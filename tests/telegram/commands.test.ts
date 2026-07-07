import { describe, it, expect } from "vitest";
import { handleMessage, INTRO, type SecretaryDeps } from "../../src/telegram/bot.js";
import { fakeConversationRepo } from "../../src/conversation/store.js";
import { readOnlyTools } from "../../src/agent/tools.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeProposalRepo, fakeActionLogRepo } from "../../src/cleanup/proposals.js";
import type { LLMProvider } from "../../src/llm/provider.js";

// An LLM that throws if the agent is ever invoked — proves /start and /help never reach it.
function deps(): SecretaryDeps {
  const llm: LLMProvider = {
    async classifyImportance() { return { important: false, suspicious: false, reason: "" }; },
    async writeBrief() { return ""; },
    async reviewTrash() { return []; },
    async agentStep() { throw new Error("agentStep should NOT be called for /start or /help"); },
  };
  return {
    userId: 1,
    gmail: fakeGmailClient({ historyId: "1", addedSince: {}, messages: {} }),
    memory: inMemoryStore(), llm, convo: fakeConversationRepo(),
    proposals: fakeProposalRepo(), actionLog: fakeActionLogRepo(), tools: readOnlyTools(),
  };
}

describe("handleMessage /start and /help", () => {
  it("/start returns the intro without invoking the LLM", async () => {
    const d = deps();
    expect(await handleMessage("/start", d)).toBe(INTRO);
  });
  it("/help returns the intro", async () => {
    expect(await handleMessage("/help", deps())).toBe(INTRO);
  });
  it("does NOT persist a conversation turn for a command", async () => {
    const d = deps();
    await handleMessage("/start", d);
    expect((await d.convo.load(1)).window).toHaveLength(0);
  });
  it("handles /start@BotName and surrounding whitespace", async () => {
    expect(await handleMessage("  /START@MyMailBot  ", deps())).toBe(INTRO);
  });
  it("a normal message still goes to the agent (LLM invoked)", async () => {
    // The agent IS reached (agentStep throws) — but the loop now catches model errors and
    // returns the safety-net reply instead of propagating, so the owner always gets an answer.
    // Getting this message (not INTRO) proves the agent path was taken.
    expect(await handleMessage("what's new?", deps())).toMatch(/ran out of time|narrow it down/i);
  });
});
