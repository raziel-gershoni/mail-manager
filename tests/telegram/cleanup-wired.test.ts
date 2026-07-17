// tests/telegram/cleanup-wired.test.ts
import { describe, it, expect } from "vitest";
import { handleMessage, SYSTEM_PROMPT, type SecretaryDeps } from "../../src/telegram/bot.js";
import { fakeConversationRepo } from "../../src/conversation/store.js";
import { readOnlyTools } from "../../src/agent/tools.js";
import { trashTools } from "../../src/cleanup/tools.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeProposalRepo, fakeActionLogRepo } from "../../src/cleanup/proposals.js";
import type { LLMProvider, AgentStep } from "../../src/llm/provider.js";

it("SYSTEM_PROMPT instructs to confirm only after owner approval", () => {
  expect(SYSTEM_PROMPT.toLowerCase()).toMatch(/propose|confirm/);
  expect(SYSTEM_PROMPT.toLowerCase()).toMatch(/recover|undo|trash/);
});

it("a scripted agent runs propose_trash then confirm_trash and the email is trashed", async () => {
  const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: {
    a: { id: "a", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "n@linkedin.com" }, { name: "Subject", value: "noise" }, { name: "List-Unsubscribe", value: "<mailto:u>" }] } },
  } });
  const proposals = fakeProposalRepo();
  let step = 0;
  const llm: LLMProvider = {
    async classifyImportance() { return { important: false, suspicious: false, reason: "" }; },
    async writeBrief() { return ""; },
    async reviewTrash() { return []; },
    async reviewPreference() { return []; },
    async agentStep(): Promise<AgentStep> {
      step++;
      if (step === 1) return { kind: "tool_calls", calls: [{ name: "propose_trash", args: { ids: ["a"], reason: "linkedin" } }] };
      if (step === 2) return { kind: "tool_calls", calls: [{ name: "confirm_trash", args: { proposalId: 1 } }] };
      return { kind: "final", text: "Trashed 1." };
    },
  };
  const deps: SecretaryDeps = { userId: 1, gmail, memory: inMemoryStore(), llm, convo: fakeConversationRepo(),
    proposals, actionLog: fakeActionLogRepo(), tools: [...readOnlyTools(), ...trashTools()] };
  const reply = await handleMessage("clean my linkedin junk, nuke it all", deps);
  expect(reply).toContain("Trashed 1."); // may carry an activity footer (· reviewed for trash · trashed)
  expect(gmail.trashedIds!()).toEqual(["a"]);
});
