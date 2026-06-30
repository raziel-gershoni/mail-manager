// tests/cleanup/tools.propose.test.ts
import { describe, it, expect } from "vitest";
import { proposeTrashTool } from "../../src/cleanup/tools.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeReviewLLM } from "../../src/llm/provider.js";
import { fakeProposalRepo, fakeActionLogRepo } from "../../src/cleanup/proposals.js";

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
});
