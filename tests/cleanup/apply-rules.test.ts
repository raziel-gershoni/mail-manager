import { describe, it, expect } from "vitest";
import { bucketByAction } from "../../src/cleanup/apply-rules.js";
import { applyActionRulesTool } from "../../src/cleanup/tools.js";
import { fakeActionLogRepo, fakeProposalRepo } from "../../src/cleanup/proposals.js";
import { fakeAgentLLM } from "../../src/llm/provider.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";

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
});
