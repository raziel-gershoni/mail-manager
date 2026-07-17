import { describe, it, expect } from "vitest";
import { runPoll } from "../../src/notifier/poll.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeSyncRepo, fakeSeenRepo } from "../../src/notifier/sync.js";
import { fakeActionLogRepo } from "../../src/cleanup/proposals.js";

function deps(action: "trash" | "archive" | null = "trash") {
  const store = inMemoryStore();
  store.upsertPreference({ key: "crypto", description: "crypto pitches are noise", verdict: "unimportant", action });
  store.confirmPreference("crypto");
  return {
    userId: 1, store,
    gmail: fakeGmailClient({
      historyId: "200", addedSince: { "100": ["c1", "keeper"] },
      messages: {
        c1: { id: "c1", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "p@coin.io" }, { name: "Subject", value: "buy bitcoin" }] } },
        keeper: { id: "keeper", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "jane@x.com" }, { name: "Subject", value: "Lunch" }] } },
      },
      bodies: { c1: "crypto pitch body", keeper: "hi" },
    }),
    llm: {
      // Only the crypto pitch is judged to match the preference.
      async classifyImportance(i: any) { return i.email.fromEmail === "p@coin.io"
        ? { important: false, suspicious: false, reason: "r", matched: "crypto" }
        : { important: true, suspicious: false, reason: "r" }; },
      async agentStep() { return { kind: "final", text: "" }; },
      async writeBrief() { return ""; },
      async reviewTrash() { throw new Error("preference path must not use reviewTrash"); },
      async reviewPreference(c: any[]) { return c.map(x => ({ id: x.id, keep: false, reason: "matches" })); },
    } as any,
    sync: fakeSyncRepo(), seen: fakeSeenRepo(), actionLog: fakeActionLogRepo(),
  };
}

describe("runPoll standing preferences", () => {
  it("trashes a preference match after reading its body: logs before mutating, defers seen, itemizes it", async () => {
    const d = deps("trash");
    const order: string[] = [];
    const origRecord = d.actionLog.record.bind(d.actionLog);
    d.actionLog.record = async (...a: any[]) => { order.push("log"); return (origRecord as any)(...a); };
    const origTrash = d.gmail.trash.bind(d.gmail);
    d.gmail.trash = async (...a: any[]) => { order.push("trash"); return (origTrash as any)(...a); };

    await d.sync.set(1, "100");
    const r = await runPoll(d as any);

    expect(d.gmail.trashedIds!()).toEqual(["c1"]);
    expect(r.prefTrashed).toBe(1);
    expect(order).toEqual(["log", "trash"]);                       // undo always covers it
    expect(await d.actionLog.lastUndoable(1)).toMatchObject({ action: "trash", messageIds: ["c1"] });
    expect(r.acted).toEqual([{ id: "c1", from: "p@coin.io", subject: "buy bitcoin", action: "trashed" }]);
    expect(r.important.map((i: any) => i.messageId)).toEqual(["keeper"]); // unrelated mail untouched
    expect(await d.seen.has(1, "c1")).toBe(false);                 // deferred until delivery
    await r.commit();
    expect(await d.seen.has(1, "c1")).toBe(true);
  });

  it("archives instead when the preference's action is archive", async () => {
    const d = deps("archive");
    await d.sync.set(1, "100");
    const r = await runPoll(d as any);
    expect(d.gmail.archivedIds!()).toEqual(["c1"]);
    expect(d.gmail.trashedIds!()).toEqual([]);
    expect(r.prefArchived).toBe(1);
    expect(r.prefTrashed).toBe(0);
  });

  it("keeps and surfaces a message the body-read judge rejects — never acts on the classifier alone", async () => {
    const d = deps("trash");
    d.llm.reviewPreference = async (c: any[]) => c.map(x => ({ id: x.id, keep: true, reason: "not actually crypto" }));
    await d.sync.set(1, "100");
    const r = await runPoll(d as any);
    expect(d.gmail.trashedIds!()).toEqual([]);
    expect(r.prefTrashed).toBe(0);
    expect(r.important.map((i: any) => i.messageId).sort()).toEqual(["c1", "keeper"]);
  });
});
