// tests/weekly/gather.test.ts
import { describe, it, expect } from "vitest";
import { gatherWeek, retroSince } from "../../src/weekly/gather.js";
import { fakeActivityRepo } from "../../src/notifier/activity.js";
import { fakeActionLogRepo, type ActionLogRepo, type ActionLogEntry } from "../../src/cleanup/proposals.js";
import { fakeOpsEventRepo } from "../../src/ops/events.js";
import { inMemoryStore, type MemoryRow } from "../../src/memory/store.js";

const HOUR = 60 * 60 * 1000;
// Sun 2026-11-01 08:00 in Jerusalem (winter, UTC+2). Seven local days back is Sun Oct 25
// 00:00 — still summer time (UTC+3) that night, since the clocks went back at 02:00.
const NOW = new Date("2026-11-01T06:00:00Z");
const SINCE = new Date("2026-10-24T21:00:00Z");

describe("retroSince (the retrospect's window: the last 7 local days plus today so far)", () => {
  it("starts at local midnight 7 days back, with that night's own offset across a DST change", () => {
    expect(retroSince(NOW, "Asia/Jerusalem")).toEqual(SINCE);
  });
  it("is the same window all Sunday long, up to local midnight", () => {
    expect(retroSince(new Date("2026-11-01T21:30:00Z"), "Asia/Jerusalem")).toEqual(SINCE); // Sun 23:30 local
  });
  it("moves a day once the local date does, even though UTC is still on Sunday", () => {
    // Mon 2026-11-02 00:00:30 local → from Mon Oct 26 00:00 local (UTC+2 by then)
    expect(retroSince(new Date("2026-11-01T22:00:30Z"), "Asia/Jerusalem")).toEqual(new Date("2026-10-25T22:00:00Z"));
  });
  it("uses summer time in summer", () => {
    expect(retroSince(new Date("2026-07-05T05:00:00Z"), "Asia/Jerusalem")).toEqual(new Date("2026-06-27T21:00:00Z"));
  });
  it("falls back to UTC for an empty or unknown timezone", () => {
    expect(retroSince(NOW, "UTC")).toEqual(new Date("2026-10-25T00:00:00Z"));
    expect(retroSince(NOW, "")).toEqual(new Date("2026-10-25T00:00:00Z"));
    expect(retroSince(NOW, "Not/AZone")).toEqual(new Date("2026-10-25T00:00:00Z"));
  });
});

function rule(slug: string, createdAt?: Date, updatedAt?: Date): MemoryRow {
  return { userId: 1, slug, description: slug, body: "", scope: "sender", matchType: "sender", matchValue: slug, verdict: "unimportant", action: "trash",
    ...(createdAt ? { createdAt } : {}), ...(updatedAt ? { updatedAt } : {}) };
}

async function setup(entries: ActionLogEntry[] = []) {
  let clockMs = 0;
  const at = (ms: number) => { clockMs = ms; };
  const activity = fakeActivityRepo(() => new Date(clockMs));
  const ops = fakeOpsEventRepo(() => new Date(clockMs));
  // The action log's window query is the repo's job (and has its own contract test);
  // here it hands back fixed runs so gatherWeek's own counting is what's tested.
  const actionLog: ActionLogRepo = { ...fakeActionLogRepo(), async runsSince() { return entries; } };
  return { at, activity, ops, actionLog };
}

describe("gatherWeek", () => {
  it("collects what was trashed/archived in the window — with id and why — oldest first; flags and other users are left out", async () => {
    const s = await setup();
    s.at(SINCE.getTime() - 1);
    await s.activity.record(1, [{ action: "trashed", from: "old@x.com", subject: "too old", messageId: "m0", source: "plain" }]);
    s.at(SINCE.getTime()); // exactly on the edge: in
    await s.activity.record(1, [{ action: "trashed", from: "edge@x.com", subject: "on the edge", messageId: "m1", source: "plain" }]);
    s.at(SINCE.getTime() + HOUR);
    await s.activity.record(1, [
      { action: "archived", from: "news@list.com", subject: "weekly", messageId: "m2", source: "guarded" },
      { action: "flagged", from: "new@sender.com", subject: "" },
      { action: "trashed", from: "legacy@x.com", subject: "logged before 0018" },
    ]);
    await s.activity.record(2, [{ action: "trashed", from: "x@y.com", subject: "someone else", messageId: "o1", source: "chat" }]);
    const f = await gatherWeek({ userId: 1, since: SINCE, activity: s.activity, actionLog: s.actionLog, store: inMemoryStore(), ops: s.ops });
    expect(f.acted).toEqual([
      { messageId: "m1", from: "edge@x.com", subject: "on the edge", action: "trashed", source: "plain", at: SINCE },
      { messageId: "m2", from: "news@list.com", subject: "weekly", action: "archived", source: "guarded", at: new Date(SINCE.getTime() + HOUR) },
      { from: "legacy@x.com", subject: "logged before 0018", action: "trashed", at: new Date(SINCE.getTime() + HOUR) },
    ]);
  });

  it("counts spam rescues made in the window and undos made in the window (even of an older run)", async () => {
    const s = await setup([
      { runId: "r1", messageIds: ["s1", "s2"], action: "unspam", at: new Date(SINCE.getTime() + HOUR), undoneAt: null },
      { runId: "r2", messageIds: ["s3"], action: "unspam", at: new Date(SINCE.getTime() - 1), undoneAt: new Date(SINCE.getTime() + 2 * HOUR) },
      { runId: "r3", messageIds: ["t1", "t2", "t3"], action: "trash", at: new Date(SINCE.getTime() + HOUR), undoneAt: null },
      { runId: "r4", messageIds: ["a1"], action: "archive", at: new Date(SINCE.getTime() + 3 * HOUR), undoneAt: new Date(SINCE.getTime() + 4 * HOUR) },
      { runId: "r5", messageIds: ["a2"], action: "archive", at: new Date(SINCE.getTime() - 2 * HOUR), undoneAt: new Date(SINCE.getTime() - HOUR) },
    ]);
    const f = await gatherWeek({ userId: 1, since: SINCE, activity: s.activity, actionLog: s.actionLog, store: inMemoryStore(), ops: s.ops });
    expect(f.rescued).toBe(2); // r1's two messages; r2 was rescued before the window
    expect(f.undone).toBe(2);  // r2 and r4 were undone inside it; r5's undo was before
  });

  it("counts rules created in the window as new, and rules created before but updated in it as changed (R4)", async () => {
    const s = await setup();
    const store = inMemoryStore([
      rule("sender:new@x.com", new Date(SINCE.getTime() + HOUR), new Date(SINCE.getTime() + HOUR)),
      rule("sender:edge@x.com", SINCE, SINCE),
      rule("sender:changed@x.com", new Date(SINCE.getTime() - 30 * 24 * HOUR), new Date(SINCE.getTime() + 2 * HOUR)),
      rule("sender:untouched@x.com", new Date(SINCE.getTime() - 30 * 24 * HOUR), new Date(SINCE.getTime() - 1)),
      rule("sender:fixture@x.com"), // no timestamps (fixtures, inMemoryStore rows): never counted
    ]);
    const f = await gatherWeek({ userId: 1, since: SINCE, activity: s.activity, actionLog: s.actionLog, store, ops: s.ops });
    expect(f.rulesNew).toBe(2);
    expect(f.rulesChanged).toBe(1);
  });

  it("passes through the window's ops events, oldest first", async () => {
    const s = await setup();
    s.at(SINCE.getTime() - 1);
    await s.ops.record(1, "reconnect_needed");
    s.at(SINCE.getTime() + 2 * HOUR);
    await s.ops.record(1, "cursor_expired");
    s.at(SINCE.getTime() + HOUR);
    await s.ops.record(1, "poll_incomplete", { processed: 40, remaining: 12 });
    const f = await gatherWeek({ userId: 1, since: SINCE, activity: s.activity, actionLog: s.actionLog, store: inMemoryStore(), ops: s.ops });
    expect(f.ops).toEqual([
      { kind: "poll_incomplete", at: new Date(SINCE.getTime() + HOUR), detail: { processed: 40, remaining: 12 } },
      { kind: "cursor_expired", at: new Date(SINCE.getTime() + 2 * HOUR), detail: null },
    ]);
  });
});
