import { describe, it, expect } from "vitest";
import { handleMessage, type SecretaryDeps } from "../../src/telegram/bot.js";
import { fakeConversationRepo } from "../../src/conversation/store.js";
import { readOnlyTools } from "../../src/agent/tools.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeProposalRepo, fakeActionLogRepo } from "../../src/cleanup/proposals.js";
import type { LLMProvider } from "../../src/llm/provider.js";

function build(replyContext?: string) {
  const seen: unknown[][] = [];
  const convo = fakeConversationRepo();
  const llm: LLMProvider = {
    async classifyImportance() { return { important: false, suspicious: false, reason: "" }; },
    async writeBrief() { return ""; },
    async reviewTrash() { return []; },
    async agentStep(messages: unknown[]) { seen.push(messages); return { kind: "final", text: "ok" }; },
  };
  const deps: SecretaryDeps = {
    userId: 1, gmail: fakeGmailClient({ historyId: "1", addedSince: {}, messages: {} }),
    memory: inMemoryStore(), llm, convo, proposals: fakeProposalRepo(), actionLog: fakeActionLogRepo(),
    tools: readOnlyTools(), replyContext,
  };
  return { deps, seen, convo };
}

describe("handleMessage reply-to injection", () => {
  it("injects the replied-to message into the LLM turn but stores only the user's own text", async () => {
    const { deps, seen, convo } = build("📬 1 new · nothing important · trashed 1");
    await handleMessage("what was that one?", deps);

    const joined = JSON.stringify(seen[0]);
    expect(joined).toContain("trashed 1");         // the replied-to message reached the model
    expect(joined).toContain("what was that one?");

    // the stored conversation turn is the user's plain text, not the reply preface
    const state = await convo.load(1);
    const userTurn = state.window.find(t => t.role === "user");
    expect(userTurn?.content).toBe("what was that one?");
  });

  it("without a replyContext, nothing extra is injected", async () => {
    const { deps, seen } = build();
    await handleMessage("hello", deps);
    const joined = JSON.stringify(seen[0]);
    expect(joined).toContain("hello");
    expect(joined).not.toContain("replying to");
  });
});
