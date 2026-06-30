// tests/cleanup/tools.confirm.test.ts
import { describe, it, expect } from "vitest";
import { confirmTrashTool } from "../../src/cleanup/tools.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeReviewLLM } from "../../src/llm/provider.js";
import { fakeProposalRepo, fakeActionLogRepo } from "../../src/cleanup/proposals.js";

function ctx() {
  return { userId: 1, memory: inMemoryStore(), proposals: fakeProposalRepo(), actionLog: fakeActionLogRepo(),
    llm: fakeReviewLLM(() => []), gmail: fakeGmailClient({ historyId: "1", addedSince: {}, messages: {} }) };
}

describe("confirmTrashTool", () => {
  const tool = confirmTrashTool();
  it("trashes the proposal's ids, logs the run, and marks confirmed", async () => {
    const c = ctx();
    const p = await c.proposals.create(1, ["a", "b"], "2");
    const res = await tool.run({ proposalId: p.id }, c) as any;
    expect(res.ok).toBe(true);
    expect(res.trashed).toBe(2);
    expect(c.gmail.trashedIds!().sort()).toEqual(["a", "b"]);
    expect((await c.proposals.get(1, p.id))?.status).toBe("confirmed");
    expect((await c.actionLog.lastUndoable(1))?.messageIds.sort()).toEqual(["a", "b"]);
  });
  it("refuses a missing or already-confirmed proposal (no trash)", async () => {
    const c = ctx();
    expect((await tool.run({ proposalId: 999 }, c) as any).ok).toBe(false);
    const p = await c.proposals.create(1, ["a"], "1");
    await c.proposals.markConfirmed(1, p.id);
    const res = await tool.run({ proposalId: p.id }, c) as any;
    expect(res.ok).toBe(false);
    expect(c.gmail.trashedIds!()).toEqual([]);
  });
});
