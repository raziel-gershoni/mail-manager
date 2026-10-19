// tests/telegram/rescue-wired.test.ts
// Review Focus 4, end to end: the owner replies "rescue 2" to a spam report that has no [2].
// Even if the model guesses an id anyway, the tool refuses it and nothing leaves Spam.
import { describe, it, expect } from "vitest";
import { handleMessage, type SecretaryDeps } from "../../src/telegram/bot.js";
import { fakeConversationRepo } from "../../src/conversation/store.js";
import { readOnlyTools } from "../../src/agent/tools.js";
import { trashTools } from "../../src/cleanup/tools.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeProposalRepo, fakeActionLogRepo } from "../../src/cleanup/proposals.js";
import { fakeAgentLLM, type AgentStep } from "../../src/llm/provider.js";

const spamMsg = (id: string) => ({ id, threadId: id, snippet: "", labelIds: ["SPAM"], payload: { headers: [{ name: "From", value: "dana@x.com" }, { name: "Subject", value: "Re: dinner" }] } });

// The replied-to spam report listed only s1. s7 is also in Spam, but was never in the report.
function deps(script: (step: number) => AgentStep) {
  const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: { s1: spamMsg("s1"), s7: spamMsg("s7") }, spam: ["s1", "s7"] });
  const actionLog = fakeActionLogRepo();
  const results: unknown[] = [];
  let step = 0;
  const llm = fakeAgentLLM((messages) => {
    const last = messages[messages.length - 1];
    if (last && last.role === "tool") results.push(last.result);
    return script(++step);
  });
  const d: SecretaryDeps = { userId: 1, gmail, memory: inMemoryStore(), llm, convo: fakeConversationRepo(),
    proposals: fakeProposalRepo(), actionLog, tools: [...readOnlyTools(), ...trashTools()],
    replyRefs: [{ id: "s1", from: "dana@x.com", subject: "Re: dinner", kind: "spam" }] };
  return { d, gmail, actionLog, results };
}

describe("rescue from a spam report, wired", () => {
  it("rescues exactly the [1] ref the owner named", async () => {
    const { d, gmail } = deps(step => step === 1
      ? { kind: "tool_calls", calls: [{ name: "rescue_from_spam", args: { ids: ["s1"] } }] }
      : { kind: "final", text: "Rescued 1." });
    await handleMessage("rescue 1", d);
    expect(gmail.unspammedIds!()).toEqual(["s1"]);
  });

  it("\"rescue 2\" with no [2]: a guessed id is refused, nothing leaves Spam, nothing is logged", async () => {
    const { d, gmail, actionLog, results } = deps(step => step === 1
      ? { kind: "tool_calls", calls: [{ name: "rescue_from_spam", args: { ids: ["s7"] } }] } // the model guessed
      : { kind: "final", text: "Which one do you mean? The report only has one." });
    await handleMessage("rescue 2", d);
    expect(results[0]).toMatchObject({ ok: false, notInReport: ["s7"] });
    expect(gmail.unspammedIds!()).toEqual([]);
    expect(gmail.spammedIds!().sort()).toEqual(["s1", "s7"]);
    expect(await actionLog.lastUndoable(1)).toBeNull();
  });
});
