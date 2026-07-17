import { describe, it, expect } from "vitest";
import { runPoll } from "../../src/notifier/poll.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeSyncRepo, fakeSeenRepo } from "../../src/notifier/sync.js";
import { fakeActionLogRepo } from "../../src/cleanup/proposals.js";
import { PREF_POLL_CAP } from "../../src/cleanup/preference-vet.js";

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

// Builds N fake messages "prefix1".."prefixN", all from the given domain, with a
// trivial body — enough for readCandidates/preferenceVet to treat them as distinct
// TrashCandidate rows.
function makeMsgs(prefix: string, domain: string, n: number) {
  const ids = Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
  const messages: Record<string, any> = {};
  const bodies: Record<string, string> = {};
  for (const id of ids) {
    messages[id] = { id, threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: `x@${domain}` }, { name: "Subject", value: `msg ${id}` }] } };
    bodies[id] = "body text";
  }
  return { ids, messages, bodies };
}

// Two distinct confirmed trash-preferences ("crypto", "junk") whose COMBINED matches
// exceed PREF_POLL_CAP, plus a third ("spam") that arrives only after the first two
// have exhausted the shared per-verb budget. Sized off the real PREF_POLL_CAP (no
// test-only cap seam exists in poll.ts — the cap is a plain constant, not injectable)
// so the group ordering/arithmetic below stays correct even if the constant changes:
//   groupA (crypto) = PREF_POLL_CAP - 1 messages → consumes all but 1 unit of budget
//   groupB (junk)   = 5 messages                  → only 1 fits in the remaining budget
//   groupC (spam)   = 2 messages                  → arrives with zero budget left
function sharedBudgetDeps() {
  const store = inMemoryStore();
  for (const key of ["crypto", "junk", "spam"]) {
    store.upsertPreference({ key, description: `${key} standing preference`, verdict: "unimportant", action: "trash" });
    store.confirmPreference(key);
  }
  const groupACount = PREF_POLL_CAP - 1;
  const crypto = makeMsgs("c", "coin.io", groupACount);
  const junk = makeMsgs("j", "junk.io", 5);
  const spam = makeMsgs("z", "spam.io", 2);
  const allIds = [...crypto.ids, ...junk.ids, ...spam.ids];
  const messages = { ...crypto.messages, ...junk.messages, ...spam.messages };
  const bodies = { ...crypto.bodies, ...junk.bodies, ...spam.bodies };

  const calls: { preference: string; ids: string[] }[] = [];

  const d = {
    userId: 1, store,
    gmail: fakeGmailClient({
      historyId: "200",
      addedSince: { "100": allIds },
      messages, bodies,
    }),
    llm: {
      async classifyImportance(i: any) {
        const email = i.email.fromEmail as string;
        if (email.endsWith("@coin.io")) return { important: false, suspicious: false, reason: "r", matched: "crypto" };
        if (email.endsWith("@junk.io")) return { important: false, suspicious: false, reason: "r", matched: "junk" };
        if (email.endsWith("@spam.io")) return { important: false, suspicious: false, reason: "r", matched: "spam" };
        return { important: true, suspicious: false, reason: "r" };
      },
      async agentStep() { return { kind: "final", text: "" }; },
      async writeBrief() { return ""; },
      async reviewTrash() { throw new Error("preference path must not use reviewTrash"); },
      // Judges every body-read candidate as a genuine match (keep:false → act),
      // so anything NOT trashed is proof the shared budget, not the judge, kept it.
      async reviewPreference(c: any[], preference: string) {
        calls.push({ preference, ids: c.map((x: any) => x.id) });
        return c.map((x: any) => ({ id: x.id, keep: false, reason: "matches" }));
      },
    } as any,
    sync: fakeSyncRepo(), seen: fakeSeenRepo(), actionLog: fakeActionLogRepo(),
    calls, crypto, junk, spam,
  };
  return d;
}

describe("runPoll standing preferences — shared per-verb budget (PREF_POLL_CAP)", () => {
  it("caps combined body-reads/acts across two trash-preference groups at PREF_POLL_CAP total, not per group", async () => {
    const d = sharedBudgetDeps();
    await d.sync.set(1, "100");
    const r = await runPoll(d as any);

    // Group A (crypto) is fully within budget; only 1 of group B (junk)'s 5 messages
    // fits in what's left. Combined reads/acts across BOTH groups == PREF_POLL_CAP,
    // never groupA.length + groupB.length (the pre-fix per-group-cap bug).
    const expectedTrashed = [...d.crypto.ids, d.junk.ids[0]];
    expect(d.gmail.trashedIds!().sort()).toEqual([...expectedTrashed].sort());
    expect(d.gmail.trashedIds!().length).toBe(PREF_POLL_CAP);
    expect(r.prefTrashed).toBe(PREF_POLL_CAP);

    // The reviewPreference calls themselves only ever saw PREF_POLL_CAP ids total
    // (not group.length ids per call) — proves the cap was applied at read time.
    const totalReadIds = d.calls.flatMap(c => c.ids);
    expect(totalReadIds.length).toBe(PREF_POLL_CAP);
  });

  it("surfaces messages beyond the shared budget as important overflow — never trashes them", async () => {
    const d = sharedBudgetDeps();
    await d.sync.set(1, "100");
    const r = await runPoll(d as any);

    const overflowIds = [...d.junk.ids.slice(1), ...d.spam.ids]; // 4 junk + 2 spam
    for (const id of overflowIds) {
      expect(d.gmail.trashedIds!()).not.toContain(id);
      const item = r.important.find((i: any) => i.messageId === id);
      expect(item).toBeDefined();
      expect(item!.reason).toContain("pref-overflow");
    }
    // Nothing falls through neither path: acted + overflowed accounts for every
    // matched message across all three groups.
    const allMatched = [...d.crypto.ids, ...d.junk.ids, ...d.spam.ids];
    const acted = new Set(d.gmail.trashedIds!());
    const overflowed = new Set(r.important.map((i: any) => i.messageId));
    for (const id of allMatched) {
      expect(acted.has(id) || overflowed.has(id)).toBe(true);
      expect(acted.has(id) && overflowed.has(id)).toBe(false); // never both
    }
  });

  it("makes no reviewPreference call at all for a group that receives zero remaining budget", async () => {
    const d = sharedBudgetDeps();
    await d.sync.set(1, "100");
    await runPoll(d as any);

    // Only crypto and junk (the groups processed before the budget hit zero) ever
    // called reviewPreference; spam's group must be skipped before any call.
    expect(d.calls.length).toBe(2);
    const calledIds = new Set(d.calls.flatMap(c => c.ids));
    for (const id of d.spam.ids) expect(calledIds.has(id)).toBe(false);
  });
});
