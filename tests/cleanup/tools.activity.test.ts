// tests/cleanup/tools.activity.test.ts
// Chat-driven trash/archive go into the activity log too (source "chat", or the rule's
// "plain"/"guarded" during an owner-requested cleanup), so recent_activity and the weekly
// retrospect see them. Best-effort: recording happens after the mutation and can never
// fail the tool.
import { describe, it, expect } from "vitest";
import { archiveMessagesTool, trashMessagesTool, confirmTrashTool, applyActionRulesTool } from "../../src/cleanup/tools.js";
import { fakeActionLogRepo, fakeProposalRepo } from "../../src/cleanup/proposals.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { fakeActivityRepo, type ActivityRepo, type ActivityRecord } from "../../src/notifier/activity.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeReviewLLM } from "../../src/llm/provider.js";
import type { ToolContext } from "../../src/agent/tools.js";

const msg = (id: string, from: string, subject: string) =>
  ({ id, threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] } });

function ctx(activity?: ActivityRepo): ToolContext {
  return {
    userId: 1,
    gmail: fakeGmailClient({ historyId: "1", addedSince: {}, messages: {
      m1: msg("m1", "Jane <jane@x.com>", "Lunch?"),
      m2: msg("m2", "promo@shop.com", "Sale"),
    } }),
    memory: inMemoryStore(), proposals: fakeProposalRepo(), actionLog: fakeActionLogRepo(), llm: fakeReviewLLM(() => []),
    ...(activity ? { activity } : {}),
  };
}
const oldestFirst = (rows: ActivityRecord[]) => [...rows].reverse().map(({ at: _at, ...r }) => r);

describe("chat trash/archive record activity", () => {
  it("trash_messages logs each trashed message with its id, sender and subject, source chat", async () => {
    const activity = fakeActivityRepo();
    const res = await trashMessagesTool().run({ ids: ["m1", "m2"] }, ctx(activity)) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(oldestFirst(activity.all(1))).toEqual([
      { action: "trashed", from: "Jane <jane@x.com>", subject: "Lunch?", messageId: "m1", source: "chat" },
      { action: "trashed", from: "promo@shop.com", subject: "Sale", messageId: "m2", source: "chat" },
    ]);
  });

  it("archive_messages logs archived", async () => {
    const activity = fakeActivityRepo();
    await archiveMessagesTool().run({ ids: ["m2"] }, ctx(activity));
    expect(oldestFirst(activity.all(1))).toEqual([{ action: "archived", from: "promo@shop.com", subject: "Sale", messageId: "m2", source: "chat" }]);
  });

  it("still logs a message it can't read back (no sender/subject), by id", async () => {
    const activity = fakeActivityRepo();
    await trashMessagesTool().run({ ids: ["ghost"] }, ctx(activity));
    expect(oldestFirst(activity.all(1))).toEqual([{ action: "trashed", from: "", subject: "", messageId: "ghost", source: "chat" }]);
  });

  it("confirm_trash logs what the owner approved trashing, source chat", async () => {
    const activity = fakeActivityRepo();
    const c = ctx(activity);
    const p = await c.proposals!.create(1, ["m1"], "1 to trash");
    await confirmTrashTool().run({ proposalId: p.id }, c);
    expect(oldestFirst(activity.all(1))).toEqual([{ action: "trashed", from: "Jane <jane@x.com>", subject: "Lunch?", messageId: "m1", source: "chat" }]);
  });

  it("apply_action_rules logs what a sender rule trashed, source plain", async () => {
    const activity = fakeActivityRepo();
    const c: ToolContext = { ...ctx(activity), memory: inMemoryStore([{ userId: 1, slug: "sender:promo@shop.com", description: "trash promo", body: "", scope: "sender", matchType: "sender", matchValue: "promo@shop.com", verdict: "unimportant", action: "trash" }]) };
    await applyActionRulesTool().run({ ids: ["m2"] }, c);
    expect(oldestFirst(activity.all(1))).toEqual([{ action: "trashed", from: "promo@shop.com", subject: "Sale", messageId: "m2", source: "plain" }]);
  });

  it("a failing activity log never fails the tool — the trash and its undo record stand", async () => {
    const failing: ActivityRepo = { ...fakeActivityRepo(), async record() { throw new Error("db down"); } };
    const c = ctx(failing);
    const res = await trashMessagesTool().run({ ids: ["m1"] }, c) as { ok: boolean; trashed: number };
    expect(res).toMatchObject({ ok: true, trashed: 1 });
    expect(c.gmail.trashedIds!()).toEqual(["m1"]);
    expect((await c.actionLog!.lastUndoable(1))?.messageIds).toEqual(["m1"]);
  });
});
