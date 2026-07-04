import { describe, it, expect } from "vitest";
import { bucketByAction } from "../../src/cleanup/apply-rules.js";
import { applyActionRulesTool } from "../../src/cleanup/tools.js";
import { fakeActionLogRepo, fakeProposalRepo } from "../../src/cleanup/proposals.js";
import { fakeAgentLLM } from "../../src/llm/provider.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { TRASH_CAP } from "../../src/cleanup/vet.js";

describe("bucketByAction", () => {
  it("buckets by rule action; groups un-ruled by sender", () => {
    const out = bucketByAction([
      { id: "1", from: "LinkedIn <no-reply@linkedin.com>", subject: "You appeared", action: "trash" },
      { id: "2", from: "Substack <x@substack.com>", subject: "Weekly", action: "archive" },
      { id: "3", from: "Medium <m@medium.com>", subject: "Today", action: null },
      { id: "4", from: "Medium <m@medium.com>", subject: "Daily", action: null },
    ], 200);
    expect(out.trash).toEqual(["1"]);
    expect(out.archive).toEqual(["2"]);
    expect(out.undecided).toEqual([{ from: "Medium <m@medium.com>", subject: "Today", ids: ["3", "4"] }]);
    expect(out.capped).toBe(false);
  });
  it("caps total acted (archive+trash) and marks capped", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: String(i), from: "a@b.com", subject: "s", action: "trash" as const }));
    const out = bucketByAction(items, 3);
    expect(out.trash.length).toBe(3);
    expect(out.capped).toBe(true);
  });
  it("routes review-action items to their own bucket (never blindly trashed), counted against the cap", () => {
    const out = bucketByAction([
      { id: "1", from: "a", subject: "s", action: "trash" },
      { id: "2", from: "b", subject: "s", action: "review" },
      { id: "3", from: "c", subject: "s", action: "review" },
    ], 200);
    expect(out.review).toEqual(["2", "3"]);
    expect(out.trash).toEqual(["1"]);
    expect(out.archive).toEqual([]);
  });
});

describe("applyActionRulesTool (integration)", () => {
  it("trashes/archives ruled ids on the real gmail client, groups the un-ruled id as undecided, and logs the actions", async () => {
    const gmail = fakeGmailClient({
      historyId: "1",
      addedSince: {},
      messages: {
        l1: { id: "l1", threadId: "t1", snippet: "s", payload: { headers: [{ name: "From", value: "LinkedIn <no-reply@linkedin.com>" }, { name: "Subject", value: "You appeared" }] } },
        s1: { id: "s1", threadId: "t2", snippet: "s", payload: { headers: [{ name: "From", value: "Substack <x@substack.com>" }, { name: "Subject", value: "Weekly" }] } },
        m1: { id: "m1", threadId: "t3", snippet: "s", payload: { headers: [{ name: "From", value: "Medium <m@medium.com>" }, { name: "Subject", value: "Today" }] } },
      },
    });
    const memory = inMemoryStore();
    memory.upsertRule({ matchValue: "linkedin.com", scope: "domain", verdict: "unimportant", description: "LinkedIn", action: "trash" });
    memory.upsertRule({ matchValue: "substack.com", scope: "domain", verdict: "unimportant", description: "Substack", action: "archive" });
    const log = fakeActionLogRepo();
    const ctx = {
      userId: 1, gmail, memory, proposals: fakeProposalRepo(), actionLog: log,
      llm: fakeAgentLLM(() => ({ kind: "final", text: "" }), () => ""),
    } as any;

    const res = await applyActionRulesTool().run({ ids: ["l1", "s1", "m1"] }, ctx) as any;

    expect(res.trashed).toBe(1);
    expect(res.archived).toBe(1);
    expect(gmail.trashedIds!()).toContain("l1");
    expect(gmail.archivedIds!()).toContain("s1");
    expect(res.undecided.length).toBe(1);
    expect(res.undecided[0].ids).toEqual(["m1"]);
    expect(await log.lastUndoable(1)).not.toBeNull();
  });

  it("caps fetch + trash at TRASH_CAP even when given a much larger id list", async () => {
    const N = TRASH_CAP + 50;
    const messages: Record<string, any> = {};
    for (let i = 0; i < N; i++) {
      messages[`m${i}`] = {
        id: `m${i}`, threadId: `t${i}`, snippet: "s",
        payload: { headers: [{ name: "From", value: `sender${i} <s${i}@bulk.com>` }, { name: "Subject", value: "junk" }] },
      };
    }
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages });
    let getMetaCalls = 0;
    const origGetMeta = gmail.getMeta.bind(gmail);
    gmail.getMeta = async (id: string) => { getMetaCalls++; return origGetMeta(id); };

    const memory = inMemoryStore();
    memory.upsertRule({ matchValue: "bulk.com", scope: "domain", verdict: "unimportant", description: "bulk", action: "trash" });
    const log = fakeActionLogRepo();
    const ctx = {
      userId: 1, gmail, memory, proposals: fakeProposalRepo(), actionLog: log,
      llm: fakeAgentLLM(() => ({ kind: "final", text: "" }), () => ""),
    } as any;

    const ids = Object.keys(messages);
    const res = await applyActionRulesTool().run({ ids }, ctx) as any;

    expect(res.trashed).toBeLessThanOrEqual(TRASH_CAP);
    expect(gmail.trashedIds!().length).toBeLessThanOrEqual(TRASH_CAP);
    expect(getMetaCalls).toBeLessThanOrEqual(TRASH_CAP);
    expect(res.capped).toBe(true);
  });

  it("guarded (review) senders: reads bodies, trashes junk (logged), returns keepers to flag", async () => {
    const gmail = fakeGmailClient({
      historyId: "1", addedSince: {},
      messages: {
        gj: { id: "gj", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "promo@shop.com" }, { name: "Subject", value: "sale" }, { name: "List-Unsubscribe", value: "<x>" }] } },
        gk: { id: "gk", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "promo@shop.com" }, { name: "Subject", value: "news" }, { name: "List-Unsubscribe", value: "<x>" }] } },
      },
      bodies: { gj: "buy now", gk: "your invoice is ready" },
    });
    const memory = inMemoryStore();
    memory.upsertRule({ matchValue: "shop.com", scope: "domain", verdict: "unimportant", description: "shop", action: "review" });
    const log = fakeActionLogRepo();
    const llm = {
      async classifyImportance() { return { important: false, suspicious: false, reason: "" }; },
      async agentStep() { return { kind: "final", text: "" }; },
      async writeBrief() { return ""; },
      async reviewTrash(c: any[]) { return c.map(x => ({ id: x.id, keep: (x.bodyText ?? "").includes("invoice"), reason: "r" })); },
    } as any;
    const ctx = { userId: 1, gmail, memory, proposals: fakeProposalRepo(), actionLog: log, llm } as any;

    // capture ordering to prove the action-log is recorded BEFORE the trash
    const order: string[] = [];
    const origRecord = log.record.bind(log);
    log.record = async (...a: any[]) => { order.push("log"); return (origRecord as any)(...a); };
    const origTrash = gmail.trash.bind(gmail);
    gmail.trash = async (...a: any[]) => { order.push("trash"); return (origTrash as any)(...a); };

    const res = await applyActionRulesTool().run({ ids: ["gj", "gk"] }, ctx) as any;

    expect(res.guardedTrashed).toBe(1);
    expect(gmail.trashedIds!()).toEqual(["gj"]);
    expect(res.guardedKept.map((k: any) => k.id)).toEqual(["gk"]);
    expect(order).toEqual(["log", "trash"]); // record before mutate
    expect(await log.lastUndoable(1)).toMatchObject({ action: "trash", messageIds: ["gj"] }); // undo covers exactly the trashed msg
  });

  it("does not mark capped when the id list is within TRASH_CAP and nothing overflows", async () => {
    const N = 5;
    const messages: Record<string, any> = {};
    for (let i = 0; i < N; i++) {
      messages[`m${i}`] = {
        id: `m${i}`, threadId: `t${i}`, snippet: "s",
        payload: { headers: [{ name: "From", value: `sender${i} <s${i}@bulk.com>` }, { name: "Subject", value: "junk" }] },
      };
    }
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages });
    const memory = inMemoryStore();
    memory.upsertRule({ matchValue: "bulk.com", scope: "domain", verdict: "unimportant", description: "bulk", action: "trash" });
    const log = fakeActionLogRepo();
    const ctx = {
      userId: 1, gmail, memory, proposals: fakeProposalRepo(), actionLog: log,
      llm: fakeAgentLLM(() => ({ kind: "final", text: "" }), () => ""),
    } as any;

    const ids = Object.keys(messages);
    const res = await applyActionRulesTool().run({ ids }, ctx) as any;

    expect(res.trashed).toBe(N);
    expect(res.capped).toBe(false);
  });
});
