// tests/ops/events.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  recordOpsEvent, recordPollOutcome, pollOutcomeEvents, fakeOpsEventRepo, OPS_RETENTION_MS, type OpsEventRepo,
} from "../../src/ops/events.js";

const T0 = new Date("2026-11-01T06:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

// A repo whose writes always fail, the way a DB outage would look to the recorder.
function failingRepo(how: "reject" | "throw"): OpsEventRepo {
  const base = fakeOpsEventRepo();
  return {
    ...base,
    record: how === "reject"
      ? async () => { throw new Error("db down"); }
      : () => { throw new Error("sync boom"); },
  };
}

describe("fakeOpsEventRepo", () => {
  it("records per user and reads back the events at or after a date, oldest first", async () => {
    let now = T0.getTime();
    const repo = fakeOpsEventRepo(() => new Date(now));
    await repo.record(1, "poll_incomplete", { processed: 3, remaining: 9 });
    now += 1000;
    await repo.record(1, "cursor_expired");
    await repo.record(2, "poll_errored", { error: "boom" });
    expect(await repo.since(1, T0)).toEqual([
      { kind: "poll_incomplete", at: T0, detail: { processed: 3, remaining: 9 } },
      { kind: "cursor_expired", at: new Date(T0.getTime() + 1000), detail: null },
    ]);
    expect((await repo.since(1, new Date(T0.getTime() + 1))).map(e => e.kind)).toEqual(["cursor_expired"]);
    expect((await repo.since(2, T0)).map(e => e.kind)).toEqual(["poll_errored"]);
  });

  it("prunes every user's events older than the cutoff and keeps the rest", async () => {
    let now = T0.getTime() - 31 * DAY;
    const repo = fakeOpsEventRepo(() => new Date(now));
    await repo.record(1, "reconnect_needed");
    await repo.record(2, "worker_failed");
    now = T0.getTime();
    await repo.record(1, "poll_incomplete", { processed: 1, remaining: 2 });
    await repo.prune(new Date(T0.getTime() - OPS_RETENTION_MS));
    expect(repo.all(1).map(e => e.kind)).toEqual(["poll_incomplete"]);
    expect(repo.all(2)).toEqual([]);
  });

  it("keeps 30 days", () => {
    expect(OPS_RETENTION_MS).toBe(30 * DAY);
  });
});

describe("recordOpsEvent", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("records the event through the repo", async () => {
    const repo = fakeOpsEventRepo(() => T0);
    await recordOpsEvent(repo, 1, "worker_failed", { updateId: "u7" });
    expect(repo.all(1)).toEqual([{ kind: "worker_failed", at: T0, detail: { updateId: "u7" } }]);
  });

  it("never throws when the repo rejects — it logs ops.record_failed instead", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(recordOpsEvent(failingRepo("reject"), 1, "reconnect_needed")).resolves.toBeUndefined();
    const logged = out.mock.calls.map(c => String(c[0])).join("\n");
    expect(logged).toContain("ops.record_failed");
    expect(logged).toContain("db down");
  });

  it("never throws when the repo throws synchronously", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(recordOpsEvent(failingRepo("throw"), 1, "poll_errored", { error: "x" })).resolves.toBeUndefined();
  });
});

describe("poll outcome events (the poll route records these from runPoll's result)", () => {
  it("a catch-up that ran out of time is poll_incomplete, with how far it got", () => {
    expect(pollOutcomeEvents({ processed: 40, remaining: 12, cursorExpired: false }))
      .toEqual([{ kind: "poll_incomplete", detail: { processed: 40, remaining: 12 } }]);
  });
  it("an expired Gmail cursor is cursor_expired", () => {
    expect(pollOutcomeEvents({ processed: 0, remaining: 0, cursorExpired: true })).toEqual([{ kind: "cursor_expired" }]);
  });
  it("a complete run records nothing", () => {
    expect(pollOutcomeEvents({ processed: 5, remaining: 0, cursorExpired: false })).toEqual([]);
  });
  it("recordPollOutcome writes them, and a failing repo can't break the poll", async () => {
    const repo = fakeOpsEventRepo(() => T0);
    await recordPollOutcome(repo, 1, { processed: 40, remaining: 12, cursorExpired: false });
    expect(repo.all(1)).toEqual([{ kind: "poll_incomplete", at: T0, detail: { processed: 40, remaining: 12 } }]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(recordPollOutcome(failingRepo("reject"), 1, { processed: 0, remaining: 0, cursorExpired: true })).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });
});
