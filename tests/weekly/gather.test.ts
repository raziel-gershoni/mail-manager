// tests/weekly/gather.test.ts
import { describe, it, expect } from "vitest";
import { gatherWeek, retroSince, retroUntil } from "../../src/weekly/gather.js";
import { weekKey } from "../../src/weekly/week.js";
import { fakeActivityRepo } from "../../src/notifier/activity.js";
import { fakeActionLogRepo, type ActionLogRepo, type ActionLogEntry } from "../../src/cleanup/proposals.js";
import { fakeOpsEventRepo } from "../../src/ops/events.js";
import { inMemoryStore, type MemoryRow } from "../../src/memory/store.js";

const HOUR = 60 * 60 * 1000;
const TZ = "Asia/Jerusalem";
// Sun 2026-11-01 08:00 in Jerusalem (winter, UTC+2). The retrospect covers the week
// before this one: from Sun Oct 25 00:00 local (still summer time, UTC+3, that night,
// since the clocks went back at 02:00) up to Sun Nov 1 00:00 local (UTC+2), exclusive.
const NOW = new Date("2026-11-01T06:00:00Z");
const SINCE = new Date("2026-10-24T21:00:00Z");
const UNTIL = new Date("2026-10-31T22:00:00Z");

describe("retroSince/retroUntil (the retrospect's window: the Sunday–Saturday local week before weekKey's)", () => {
  it("is the previous local week, each edge with that night's own offset across a DST change", () => {
    expect(retroSince(NOW, TZ)).toEqual(SINCE);
    expect(retroUntil(NOW, TZ)).toEqual(UNTIL);
  });
  it("ends exactly where this week (weekKey's Sunday) starts, so Sunday's catch-up waits for next week", () => {
    expect(weekKey(NOW, TZ)).toBe("2026-11-01");
    expect(weekKey(UNTIL, TZ)).toBe("2026-11-01");                      // the edge is this week's first instant
    expect(weekKey(new Date(UNTIL.getTime() - 1), TZ)).toBe("2026-10-25"); // and 1ms before is last week's
    expect(weekKey(SINCE, TZ)).toBe("2026-10-25");
  });
  it("two consecutive Sunday runs see disjoint windows that tile: the next starts where this one ended", () => {
    const nextSunday = new Date("2026-11-08T06:00:00Z"); // Sun Nov 8 08:00 local
    expect(retroSince(nextSunday, TZ)).toEqual(UNTIL);
    expect(retroUntil(nextSunday, TZ)).toEqual(new Date("2026-11-07T22:00:00Z"));
  });
  it("keeps the same window all week, so a retro that slips past Sunday neither skips nor repeats a day", () => {
    for (const at of [
      "2026-11-01T21:30:00Z", // Sun 23:30 local
      "2026-11-01T22:00:30Z", // Mon 00:00:30 local (UTC still on Sunday)
      "2026-11-07T21:59:00Z", // Sat 23:59 local
    ]) {
      expect(retroSince(new Date(at), TZ)).toEqual(SINCE);
      expect(retroUntil(new Date(at), TZ)).toEqual(UNTIL);
    }
  });
  it("moves a week once the local date reaches Sunday, even though UTC is still on Saturday", () => {
    // Sat Oct 31 23:30 local: still the week of Oct 25, so the window is the week before that
    expect(retroSince(new Date("2026-10-31T21:30:00Z"), TZ)).toEqual(new Date("2026-10-17T21:00:00Z"));
    expect(retroUntil(new Date("2026-10-31T21:30:00Z"), TZ)).toEqual(SINCE);
    // Sun Nov 1 00:00:30 local
    expect(retroSince(new Date("2026-10-31T22:00:30Z"), TZ)).toEqual(SINCE);
    expect(retroUntil(new Date("2026-10-31T22:00:30Z"), TZ)).toEqual(UNTIL);
  });
  it("uses summer time in summer", () => {
    expect(retroSince(new Date("2026-07-05T05:00:00Z"), TZ)).toEqual(new Date("2026-06-27T21:00:00Z"));
    expect(retroUntil(new Date("2026-07-05T05:00:00Z"), TZ)).toEqual(new Date("2026-07-04T21:00:00Z"));
  });
  it("starts the week at 01:00 where the clocks spring forward AT Sunday midnight, so 00:00 never happens", () => {
    // America/Santiago, Sun 2026-09-06: Sat 23:59:59 (UTC-4) is followed by Sun 01:00 (UTC-3)
    const santiago = "America/Santiago";
    const sundayNoon = new Date("2026-09-06T15:00:00Z");
    expect(retroUntil(sundayNoon, santiago)).toEqual(new Date("2026-09-06T04:00:00Z"));
    expect(retroSince(sundayNoon, santiago)).toEqual(new Date("2026-08-30T04:00:00Z")); // Sun Aug 30 00:00 (UTC-4)
    expect(weekKey(retroUntil(sundayNoon, santiago), santiago)).toBe("2026-09-06");
    expect(weekKey(new Date(retroUntil(sundayNoon, santiago).getTime() - 1), santiago)).toBe("2026-08-30"); // Saturday's last hour stays in its own week
    expect(retroSince(new Date("2026-09-13T15:00:00Z"), santiago)).toEqual(retroUntil(sundayNoon, santiago));
  });
  it("falls back to UTC for an empty or unknown timezone", () => {
    for (const tz of ["UTC", "", "Not/AZone"]) {
      expect(retroSince(NOW, tz)).toEqual(new Date("2026-10-25T00:00:00Z"));
      expect(retroUntil(NOW, tz)).toEqual(new Date("2026-11-01T00:00:00Z"));
    }
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
    const f = await gatherWeek({ userId: 1, since: SINCE, until: UNTIL, activity: s.activity, actionLog: s.actionLog, store: inMemoryStore(), ops: s.ops });
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
    const f = await gatherWeek({ userId: 1, since: SINCE, until: UNTIL, activity: s.activity, actionLog: s.actionLog, store: inMemoryStore(), ops: s.ops });
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
    const f = await gatherWeek({ userId: 1, since: SINCE, until: UNTIL, activity: s.activity, actionLog: s.actionLog, store, ops: s.ops });
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
    const f = await gatherWeek({ userId: 1, since: SINCE, until: UNTIL, activity: s.activity, actionLog: s.actionLog, store: inMemoryStore(), ops: s.ops });
    expect(f.ops).toEqual([
      { kind: "poll_incomplete", at: new Date(SINCE.getTime() + HOUR), detail: { processed: 40, remaining: 12 } },
      { kind: "cursor_expired", at: new Date(SINCE.getTime() + 2 * HOUR), detail: null },
    ]);
  });

  it("leaves out everything at or after `until` — this week's Sunday catch-up belongs to next week's report", async () => {
    const AFTER = new Date(NOW.getTime() - 60_000); // Sun 07:59 local: this week's catch-up, recorded just before the retro runs
    const s = await setup([
      { runId: "r1", messageIds: ["s1"], action: "unspam", at: new Date(UNTIL.getTime() - 1), undoneAt: null },
      { runId: "r2", messageIds: ["s2", "s3"], action: "unspam", at: UNTIL, undoneAt: null },
      { runId: "r3", messageIds: ["t1"], action: "trash", at: new Date(SINCE.getTime() + HOUR), undoneAt: new Date(UNTIL.getTime() - 1) },
      { runId: "r4", messageIds: ["t2"], action: "trash", at: new Date(SINCE.getTime() + HOUR), undoneAt: AFTER },
    ]);
    s.at(UNTIL.getTime() - 1); // Sat 23:59:59.999 local: in
    await s.activity.record(1, [{ action: "trashed", from: "last@x.com", subject: "Saturday night", messageId: "m1", source: "plain" }]);
    await s.ops.record(1, "poll_errored");
    s.at(UNTIL.getTime()); // Sun 00:00 local: out
    await s.activity.record(1, [{ action: "trashed", from: "edge@x.com", subject: "midnight", messageId: "m2", source: "plain" }]);
    await s.ops.record(1, "cursor_expired");
    s.at(AFTER.getTime());
    await s.activity.record(1, [{ action: "archived", from: "catchup@x.com", subject: "Sunday catch-up", messageId: "m3", source: "guarded" }]);
    await s.ops.record(1, "poll_incomplete", { processed: 40, remaining: 12 });
    const store = inMemoryStore([
      rule("sender:new-in@x.com", new Date(UNTIL.getTime() - 1), new Date(UNTIL.getTime() - 1)),
      rule("sender:new-after@x.com", UNTIL, AFTER),                                                 // made this week: not new, not changed
      rule("sender:changed-after@x.com", new Date(SINCE.getTime() - 30 * 24 * HOUR), AFTER),        // changed this week: next week's
    ]);
    const f = await gatherWeek({ userId: 1, since: SINCE, until: UNTIL, activity: s.activity, actionLog: s.actionLog, store, ops: s.ops });
    expect(f.acted.map(a => a.messageId)).toEqual(["m1"]);
    expect(f.rescued).toBe(1); // r1 only; r2 ran on the edge
    expect(f.undone).toBe(1);  // r3 only; r4 was undone this week
    expect(f.rulesNew).toBe(1);
    expect(f.rulesChanged).toBe(0);
    expect(f.ops.map(e => e.kind)).toEqual(["poll_errored"]);
  });

  it("two consecutive Sunday retros report each fact exactly once: the windows don't overlap and leave no gap", async () => {
    const nextSunday = new Date("2026-11-08T06:00:00Z"); // the following retro, Sun Nov 8 08:00 local
    let clockMs = 0;
    const activity = fakeActivityRepo(() => new Date(clockMs));
    const ops = fakeOpsEventRepo(() => new Date(clockMs));
    const log: ActionLogEntry[] = [];
    const actionLog: ActionLogRepo = { ...fakeActionLogRepo(), async runsSince(_u, since) {
      return log.filter(r => r.at.getTime() >= since.getTime() || (r.undoneAt !== null && r.undoneAt.getTime() >= since.getTime()));
    } };
    const store = inMemoryStore([
      rule("sender:week1@x.com", new Date(SINCE.getTime() + HOUR), new Date(SINCE.getTime() + HOUR)),
      rule("sender:sunday@x.com", new Date(NOW.getTime() - HOUR), new Date(NOW.getTime() - HOUR)), // made Sunday, before the retro
    ]);
    // Something happens every 6 hours from the first window's start to the second retro,
    // including Sunday's catch-up just before the first retro runs.
    const ids: string[] = [];
    for (let t = SINCE.getTime(), i = 0; t < nextSunday.getTime(); t += 6 * HOUR, i++) {
      clockMs = t;
      ids.push(`m${i}`);
      await activity.record(1, [{ action: "trashed", from: `s${i}@x.com`, subject: `#${i}`, messageId: `m${i}`, source: "plain" }]);
      await ops.record(1, "poll_incomplete", { processed: i, remaining: 1 });
      log.push({ runId: `r${i}`, messageIds: [`u${i}`], action: "unspam", at: new Date(t), undoneAt: null });
    }
    const retro = (now: Date) => gatherWeek({ userId: 1, since: retroSince(now, TZ), until: retroUntil(now, TZ), activity, actionLog, store, ops });
    const first = await retro(NOW);
    const second = await retro(nextSunday);
    const firstIds = first.acted.map(a => a.messageId!);
    const secondIds = second.acted.map(a => a.messageId!);
    expect(firstIds.filter(id => secondIds.includes(id))).toEqual([]); // nothing reported twice
    expect(firstIds.length).toBeGreaterThan(0);
    expect(secondIds.length).toBeGreaterThan(0);
    // The two windows together cover everything from the first window's start up to the
    // second retro's week — Sunday Nov 1's events included, in the second report only.
    const covered = ids.filter((_, i) => SINCE.getTime() + i * 6 * HOUR < retroUntil(nextSunday, TZ).getTime());
    expect([...firstIds, ...secondIds]).toEqual(covered);
    expect(first.acted.every(a => a.at.getTime() < UNTIL.getTime())).toBe(true);
    expect(second.acted.every(a => a.at.getTime() >= UNTIL.getTime())).toBe(true);
    expect(first.rescued + second.rescued).toBe(covered.length);
    expect(first.ops.length + second.ops.length).toBe(covered.length);
    expect([first.rulesNew, second.rulesNew]).toEqual([1, 1]); // Sunday's rule counted once, the week after
  });
});
