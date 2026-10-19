// tests/cleanup/tools.rescue.test.ts
import { describe, it, expect } from "vitest";
import { rescueFromSpamTool, undoLastTool } from "../../src/cleanup/tools.js";
import { fakeActionLogRepo, fakeProposalRepo } from "../../src/cleanup/proposals.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import type { GmailRawMessage } from "../../src/gmail/headers.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeLLM } from "../../src/llm/provider.js";
import type { ToolContext } from "../../src/agent/tools.js";

const UNDONE_AT = new Date("2026-10-18T07:00:00Z");
const msg = (id: string, labelIds: string[]): GmailRawMessage =>
  ({ id, threadId: id, snippet: "", labelIds, payload: { headers: [{ name: "From", value: "dana@x.com" }, { name: "Subject", value: "Re: dinner" }] } });

function setup() {
  const gmail = fakeGmailClient({
    historyId: "1", addedSince: {},
    messages: { s1: msg("s1", ["SPAM"]), s2: msg("s2", ["SPAM"]), i1: msg("i1", ["INBOX"]) },
    spam: ["s1", "s2"],
  });
  const actionLog = fakeActionLogRepo(() => UNDONE_AT);
  const ctx: ToolContext = { userId: 1, gmail, memory: inMemoryStore(), proposals: fakeProposalRepo(), actionLog,
    llm: fakeLLM(() => ({ important: false, suspicious: false, reason: "" })) };
  return { gmail, actionLog, ctx };
}

describe("rescue_from_spam", () => {
  it("moves the named spam into the inbox and logs it as an unspam run", async () => {
    const { gmail, actionLog, ctx } = setup();
    const res = await rescueFromSpamTool().run({ ids: ["s1", "s2"], reason: "owner: rescue all" }, ctx) as any;
    expect(res).toMatchObject({ ok: true, rescued: 2 });
    expect(gmail.spammedIds!()).toEqual([]);
    expect(gmail.unspammedIds!().sort()).toEqual(["s1", "s2"]);
    expect(await actionLog.lastUndoable(1)).toEqual({ runId: res.runId, messageIds: ["s1", "s2"], action: "unspam" });
  });

  it("writes the action log BEFORE it moves any mail", async () => {
    const { gmail, actionLog, ctx } = setup();
    const order: string[] = [];
    const record = actionLog.record.bind(actionLog);
    actionLog.record = async (...a) => { order.push("log"); return record(...a); };
    const unspam = gmail.unspam.bind(gmail);
    gmail.unspam = async (ids: string[]) => {
      order.push("unspam");
      expect((await actionLog.lastUndoable(1))?.messageIds).toEqual(ids); // undo already covers it
      return unspam(ids);
    };
    await rescueFromSpamTool().run({ ids: ["s1"] }, ctx);
    expect(order).toEqual(["log", "unspam"]);
  });

  // Review Focus 4: a guessed id never moves anything.
  it("refuses ids that aren't in Spam — and then moves nothing and logs nothing", async () => {
    const { gmail, actionLog, ctx } = setup();
    const res = await rescueFromSpamTool().run({ ids: ["s1", "i1"] }, ctx) as any;
    expect(res.ok).toBe(false);
    expect(res.notInSpam).toEqual(["i1"]);
    expect(gmail.spammedIds!()).toEqual(["s1", "s2"]);
    expect(gmail.unspammedIds!()).toEqual([]);
    expect(await actionLog.lastUndoable(1)).toBeNull();
  });

  it("refuses an id that doesn't exist (a guessed id)", async () => {
    const { gmail, ctx } = setup();
    const res = await rescueFromSpamTool().run({ ids: ["s9"] }, ctx) as any;
    expect(res).toMatchObject({ ok: false, notInSpam: ["s9"] });
    expect(gmail.unspammedIds!()).toEqual([]);
  });

  it("when replying to a spam report, refuses ids that aren't among its refs (even ones in Spam)", async () => {
    const { gmail, ctx } = setup();
    ctx.replyRefs = [{ id: "s1", from: "dana@x.com", subject: "Re: dinner", kind: "spam" }];
    const res = await rescueFromSpamTool().run({ ids: ["s1", "s2"] }, ctx) as any;
    expect(res).toMatchObject({ ok: false, notInReport: ["s2"] });
    expect(gmail.unspammedIds!()).toEqual([]);
    expect(await rescueFromSpamTool().run({ ids: ["s1"] }, ctx)).toMatchObject({ ok: true, rescued: 1 });
  });

  it("a phishing-flagged ref is still a report ref (the confirmation is the agent's job)", async () => {
    const { ctx } = setup();
    ctx.replyRefs = [{ id: "s2", from: "bank@x.com", subject: "Card blocked", kind: "spam-phishing" }];
    expect(await rescueFromSpamTool().run({ ids: ["s2"] }, ctx)).toMatchObject({ ok: true, rescued: 1 });
  });

  it("refs from a non-spam message (an hourly digest) don't restrict a rescue", async () => {
    const { ctx } = setup();
    ctx.replyRefs = [{ id: "i1", from: "boss@work.com", subject: "urgent", kind: "surfaced" }];
    expect(await rescueFromSpamTool().run({ ids: ["s2"] }, ctx)).toMatchObject({ ok: true, rescued: 1 });
  });

  it("refuses an empty, missing or malformed id list", async () => {
    const { ctx } = setup();
    for (const args of [{ ids: [] }, {}, { ids: "s1" }, { ids: [1, null, ""] }]) {
      expect(await rescueFromSpamTool().run(args as Record<string, unknown>, ctx)).toEqual({ ok: false, error: "no ids" });
    }
  });

  it("dedupes repeated ids", async () => {
    const { actionLog, ctx } = setup();
    const res = await rescueFromSpamTool().run({ ids: ["s1", "s1"] }, ctx) as any;
    expect(res.rescued).toBe(1);
    expect((await actionLog.lastUndoable(1))!.messageIds).toEqual(["s1"]);
  });

  it("refuses more than a report's worth of ids", async () => {
    const { ctx } = setup();
    const ids = Array.from({ length: 301 }, (_, i) => `x${i}`);
    expect(await rescueFromSpamTool().run({ ids }, ctx)).toEqual({ ok: false, error: "too many ids (max 300)" });
  });

  it("undo_last puts a rescue back in Spam and stamps when it was undone", async () => {
    const { gmail, actionLog, ctx } = setup();
    const { runId } = await rescueFromSpamTool().run({ ids: ["s1", "s2"] }, ctx) as any;
    const res = await undoLastTool().run({}, ctx) as any;
    expect(res).toEqual({ ok: true, restored: 2, action: "unspam" });
    expect(gmail.spammedIds!().sort()).toEqual(["s1", "s2"]);
    expect(gmail.unspammedIds!()).toEqual([]);
    expect(actionLog.undoneAt(1, runId)).toEqual(UNDONE_AT);
    expect(await actionLog.lastUndoable(1)).toBeNull();
  });
});
