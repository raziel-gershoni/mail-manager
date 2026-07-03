// tests/cleanup/tools.propose.test.ts
import { describe, it, expect } from "vitest";
import { proposeTrashTool } from "../../src/cleanup/tools.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeReviewLLM } from "../../src/llm/provider.js";
import { fakeProposalRepo, fakeActionLogRepo } from "../../src/cleanup/proposals.js";
import { TRASH_CAP } from "../../src/cleanup/vet.js";

function ctx(reviewer = () => [] as any) {
  return {
    userId: 1, memory: inMemoryStore(), proposals: fakeProposalRepo(), actionLog: fakeActionLogRepo(), llm: fakeReviewLLM(reviewer),
    gmail: fakeGmailClient({ historyId: "1", addedSince: {}, messages: {
      a: { id: "a", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "n@linkedin.com" }, { name: "Subject", value: "You appeared in 9 searches" }, { name: "List-Unsubscribe", value: "<mailto:u>" }] } },
      b: { id: "b", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "jane@x.com" }, { name: "Subject", value: "Lunch?" }] } },
    } }),
  };
}

describe("proposeTrashTool", () => {
  const tool = proposeTrashTool();
  it("vets candidates and writes a pending proposal of only the auto-trash set", async () => {
    const c = ctx();
    const res = await tool.run({ ids: ["a", "b"], reason: "clean linkedin" }, c) as any;
    expect(res.willTrash).toBe(1);                 // only the bulk 'a' is eligible; 'b' (not bulk) set aside
    expect(res.setAside.map((s: any) => s.id)).toContain("b");
    const p = await c.proposals.get(1, res.proposalId);
    expect(p?.messageIds).toEqual(["a"]);
    expect(p?.status).toBe("pending");
  });
  it("throws when cleanup deps are missing", async () => {
    const bare = { userId: 1, memory: inMemoryStore(), gmail: ctx().gmail } as any;
    await expect(tool.run({ ids: ["a"], reason: "x" }, bare)).rejects.toThrow(/cleanup deps/i);
  });
  it("marks capped when given more ids than TRASH_CAP, even if none are rescued", async () => {
    const N = TRASH_CAP + 50;
    const messages: Record<string, any> = {};
    for (let i = 0; i < N; i++) {
      messages[`m${i}`] = {
        id: `m${i}`, threadId: `t${i}`, snippet: "",
        payload: { headers: [
          { name: "From", value: `sender${i} <s${i}@bulk.com>` },
          { name: "Subject", value: "junk" },
          { name: "List-Unsubscribe", value: "<mailto:u>" },
        ] },
      };
    }
    const c = {
      userId: 1, memory: inMemoryStore(), proposals: fakeProposalRepo(), actionLog: fakeActionLogRepo(),
      llm: fakeReviewLLM(() => []),
      gmail: fakeGmailClient({ historyId: "1", addedSince: {}, messages }),
    };
    const ids = Object.keys(messages);
    const res = await tool.run({ ids, reason: "clean bulk" }, c) as any;
    expect(res.willTrash).toBeLessThanOrEqual(TRASH_CAP);
    expect(res.capped).toBe(true);
    expect(res.summary).toMatch(/capped/);
  });
});
