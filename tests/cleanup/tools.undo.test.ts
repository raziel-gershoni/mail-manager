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
    await c.actionLog.record(1, "run1", ["a", "b"], "trash");
    const res = await tool.run({}, c) as any;
    expect(res.ok).toBe(true);
    expect(res.restored).toBe(2);
    expect(c.gmail.trashedIds!()).toEqual([]);
    expect((await tool.run({}, c) as any).ok).toBe(false); // nothing left to undo
  });
});

describe("undoLastTool archive reversal", () => {
  it("undo_last reverses an archive action via unarchive", async () => {
    const { undoLastTool } = await import("../../src/cleanup/tools.js");
    const { fakeActionLogRepo, fakeProposalRepo } = await import("../../src/cleanup/proposals.js");
    const { fakeGmailClient } = await import("../../src/gmail/client.js");
    const { fakeAgentLLM } = await import("../../src/llm/provider.js");
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: {} });
    await gmail.archive(["m1"]);
    const actionLog = fakeActionLogRepo();
    await actionLog.record(1, "run-1", ["m1"], "archive");
    const ctx: any = { userId: 1, gmail, memory: null, proposals: fakeProposalRepo(), actionLog, llm: fakeAgentLLM(() => ({ kind: "final", text: "" }), () => "") };
    const res = await undoLastTool().run({}, ctx) as any;
    expect(res.ok).toBe(true);
    expect(gmail.archivedIds!()).toEqual([]);       // unarchived
  });
});

describe("trashTools", () => {
  it("exposes exactly the five cleanup tools", () => {
    expect(trashTools().map(t => t.schema.name)).toEqual(["propose_trash", "confirm_trash", "undo_last", "archive_messages", "trash_messages"]);
  });
});
