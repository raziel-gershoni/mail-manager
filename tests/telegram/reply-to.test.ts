import { describe, it, expect } from "vitest";
import { handleMessage, type SecretaryDeps } from "../../src/telegram/bot.js";
import { fakeConversationRepo } from "../../src/conversation/store.js";
import { readOnlyTools } from "../../src/agent/tools.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeProposalRepo, fakeActionLogRepo } from "../../src/cleanup/proposals.js";
import type { LLMProvider } from "../../src/llm/provider.js";

function build(over: Partial<SecretaryDeps> = {}) {
  const seen: unknown[][] = [];
  const convo = fakeConversationRepo();
  const llm: LLMProvider = {
    async classifyImportance() { return { important: false, suspicious: false, reason: "" }; },
    async writeBrief() { return ""; },
    async extractAttachment() { return ""; },
    async reviewTrash() { return []; },
    async reviewPreference() { return []; },
    async reviewActed() { return { verdicts: [], unjudged: 0 }; },
    async reviewSpam() { return { verdicts: [], unjudged: 0 }; },
    async agentStep(messages: unknown[]) { seen.push(messages); return { kind: "final", text: "ok" }; },
  };
  const deps: SecretaryDeps = {
    userId: 1, gmail: fakeGmailClient({ historyId: "1", addedSince: {}, messages: {} }),
    memory: inMemoryStore(), llm, convo, proposals: fakeProposalRepo(), actionLog: fakeActionLogRepo(),
    tools: readOnlyTools(), ...over,
  };
  return { deps, seen, convo };
}

describe("handleMessage reply-to injection", () => {
  it("injects the replied-to message into the LLM turn but stores only the user's own text", async () => {
    const { deps, seen, convo } = build({ replyContext: "📬 1 new · nothing important · trashed 1" });
    await handleMessage("what was that one?", deps);

    const joined = JSON.stringify(seen[0]);
    expect(joined).toContain("trashed 1");         // the replied-to message reached the model
    expect(joined).toContain("what was that one?");

    // the stored conversation turn is the user's plain text, not the reply preface
    const state = await convo.load(1);
    const userTurn = state.window.find(t => t.role === "user");
    expect(userTurn?.content).toBe("what was that one?");
  });

  it("without a reply, the user message is passed through with no injected context block", async () => {
    const { deps, seen } = build();
    await handleMessage("hello", deps);
    const msgs = seen[0] as Array<{ role: string; content: string }>;
    const userMsg = msgs.find(m => m.role === "user");
    expect(userMsg?.content).toBe("hello"); // exactly the text — no reply preface prepended
  });

  it("injects the EXACT Gmail ids when the replied-to digest was coupled (replyRefs win over text)", async () => {
    const { deps, seen } = build({
      replyContext: "📬 2 new · nothing important · trashed 2", // fuzzy text also present
      replyRefs: [
        { id: "j1", from: "promo@shop.com", subject: "50% off", kind: "trashed" },
        { id: "j2", from: "news@list.com", subject: "weekly", kind: "trashed" },
      ],
    });
    await handleMessage("undo the shop one", deps);
    const joined = JSON.stringify(seen[0]);
    expect(joined).toContain("id=j1");            // exact ids injected
    expect(joined).toContain("id=j2");
    expect(joined).toContain("do NOT guess");     // precise-mode instruction
    expect(joined).not.toContain('"""');          // used refs, not the untrusted-text fallback
  });

  it("numbers the refs [1], [2]… in saved order, so \"rescue 1 3\" resolves to exact ids", async () => {
    const { deps, seen } = build({
      replyRefs: [
        { id: "s1", from: "dana@x.com", subject: "Re: dinner", kind: "spam" },
        { id: "s2", from: "bank@x.com", subject: "Card blocked", kind: "spam-phishing" },
        { id: "s3", from: "shop@x.com", subject: "Your order", kind: "spam" },
      ],
    });
    await handleMessage("rescue 1 3", deps);
    const userMsg = (seen[0] as Array<{ role: string; content: string }>).find(m => m.role === "user")!.content;
    expect(userMsg).toContain('[1] id=s1 (spam) — from/subject (UNTRUSTED labels): dana@x.com — "Re: dinner"');
    expect(userMsg).toContain("[2] id=s2 (spam-phishing)");
    expect(userMsg).toContain("[3] id=s3 (spam)");
    expect(userMsg.indexOf("[1] id=s1")).toBeLessThan(userMsg.indexOf("[2] id=s2"));
    expect(userMsg).toContain("do NOT guess");
    expect(userMsg.endsWith("rescue 1 3")).toBe(true);
  });
});
