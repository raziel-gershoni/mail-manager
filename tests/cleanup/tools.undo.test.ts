import { describe, it, expect } from "vitest";
import { undoLastTool, trashTools } from "../../src/cleanup/tools.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeReviewLLM } from "../../src/llm/provider.js";
import { fakeProposalRepo, fakeActionLogRepo } from "../../src/cleanup/proposals.js";

function ctx() {
  const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: {} });
  return { userId: 1, memory: inMemoryStore(), proposals: fakeProposalRepo(), actionLog: fakeActionLogRepo(),
    llm: fakeReviewLLM(() => []), gmail };
}

describe("undoLastTool", () => {
  const tool = undoLastTool();
  it("untrashes the last run and marks it undone", async () => {
    const c = ctx();
    await c.gmail.trash(["a", "b"]);
    await c.actionLog.record(1, "run1", ["a", "b"]);
    const res = await tool.run({}, c) as any;
    expect(res.ok).toBe(true);
    expect(res.restored).toBe(2);
    expect(c.gmail.trashedIds!()).toEqual([]);
    expect((await tool.run({}, c) as any).ok).toBe(false); // nothing left to undo
  });
});

describe("trashTools", () => {
  it("exposes exactly the three cleanup tools", () => {
    expect(trashTools().map(t => t.schema.name)).toEqual(["propose_trash", "confirm_trash", "undo_last"]);
  });
});
