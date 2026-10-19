// tests/weekly/run.test.ts
import { describe, it, expect } from "vitest";
import { runWeeklyJobs, WEEKLY_START_BY_MS, WEEKLY_DEADLINE_MS, type WeeklyDeps, type WeeklyJob, type WeeklyReport } from "../../src/weekly/run.js";
import { fakeWeeklyRunRepo, type WeeklyKind } from "../../src/weekly/runs.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { fakeLLM } from "../../src/llm/provider.js";
import { inMemoryStore } from "../../src/memory/store.js";
import type { DigestRef } from "../../src/notifier/refs.js";

const HOUR = 3_600_000;
const RUN_START = Date.parse("2026-10-18T06:00:00Z"); // Sunday 09:00 in Jerusalem
const WEEK = "2026-10-18";

function harness(over: Partial<WeeklyDeps> = {}) {
  const sent: { text: string; silent: boolean }[] = [];
  const saved: { messageId: number; refs: DigestRef[] }[] = [];
  let nextId = 100;
  const deps: WeeklyDeps = {
    userId: 1, chatId: 555, timezone: "Asia/Jerusalem", language: "en",
    runStart: RUN_START, now: () => RUN_START + 210_000, // the hourly flow took 210s
    gmail: fakeGmailClient({ historyId: "1", addedSince: {}, messages: {} }),
    llm: fakeLLM(() => ({ important: false, suspicious: false, reason: "" })),
    store: inMemoryStore(), runs: fakeWeeklyRunRepo(),
    send: async (text, opts) => { sent.push({ text, silent: opts.silent }); return nextId++; },
    saveRefs: async (messageId, refs) => { saved.push({ messageId, refs }); },
    ...over,
  };
  return { deps, sent, saved };
}

// A job that records each call (with the deadline it was given) and returns a fixed report.
function job(kind: WeeklyKind, report: Partial<WeeklyReport> = {}, run?: () => Promise<void>) {
  const deadlines: number[] = [];
  const j: WeeklyJob = {
    kind,
    async run(_deps, deadline) {
      deadlines.push(deadline);
      if (run) await run();
      return { text: `${kind} report`, silent: true, refs: [], ...report };
    },
  };
  return { job: j, deadlines };
}

describe("runWeeklyJobs", () => {
  it("runs each job once per calendar week and records the week only once it has reported", async () => {
    const h = harness();
    const spam = job("spam");
    await runWeeklyJobs(h.deps, [spam.job]);
    expect(h.sent).toEqual([{ text: "spam report", silent: true }]);
    expect(await h.deps.runs.get(1, "spam")).toBe(WEEK);

    // Same week, next hour: nothing more.
    const later = harness({ runs: h.deps.runs, runStart: RUN_START + HOUR, now: () => RUN_START + HOUR + 1_000 });
    await runWeeklyJobs(later.deps, [spam.job]);
    expect(spam.deadlines).toHaveLength(1);
    expect(later.sent).toEqual([]);
  });

  it("runs again in a new week", async () => {
    const h = harness();
    await h.deps.runs.set(1, "spam", "2026-10-11"); // last week's report
    const spam = job("spam");
    await runWeeklyJobs(h.deps, [spam.job]);
    expect(spam.deadlines).toHaveLength(1);
    expect(await h.deps.runs.get(1, "spam")).toBe(WEEK);
  });

  it("keys the week in the user's timezone (already Sunday in Jerusalem while UTC is still Saturday)", async () => {
    const satNightUtc = Date.parse("2026-10-17T21:30:00Z"); // Sun 00:30 in Jerusalem
    const h = harness({ runStart: satNightUtc, now: () => satNightUtc + 1_000 });
    await h.deps.runs.set(1, "spam", "2026-10-11");
    await runWeeklyJobs(h.deps, [job("spam").job]);
    expect(await h.deps.runs.get(1, "spam")).toBe("2026-10-18");

    const utc = harness({ timezone: "UTC", runStart: satNightUtc, now: () => satNightUtc + 1_000 });
    await utc.deps.runs.set(1, "spam", "2026-10-11");
    await runWeeklyJobs(utc.deps, [job("spam").job]);
    expect(utc.sent).toEqual([]); // still last week in UTC
  });

  it("never sets the key when the send fails, so the next hour retries", async () => {
    const h = harness({ send: async () => { throw new Error("telegram down"); } });
    const spam = job("spam");
    await runWeeklyJobs(h.deps, [spam.job]);
    expect(await h.deps.runs.get(1, "spam")).toBeNull();

    const retry = harness({ runs: h.deps.runs, runStart: RUN_START + HOUR, now: () => RUN_START + HOUR + 1_000 });
    await runWeeklyJobs(retry.deps, [spam.job]);
    expect(spam.deadlines).toHaveLength(2); // ran again
    expect(retry.sent).toEqual([{ text: "spam report", silent: true }]);
    expect(await retry.deps.runs.get(1, "spam")).toBe(WEEK);
  });

  it("isolates jobs: one that throws leaves its own key unset and the next job still reports", async () => {
    const h = harness();
    const broken = job("spam", {}, async () => { throw new Error("gmail 500"); });
    const retro = job("retro");
    await runWeeklyJobs(h.deps, [broken.job, retro.job]);
    expect(await h.deps.runs.get(1, "spam")).toBeNull();
    expect(h.sent).toEqual([{ text: "retro report", silent: true }]);
    expect(await h.deps.runs.get(1, "retro")).toBe(WEEK);
  });

  it("skips when the hourly catch-up left too little time — keys stay unset and the next hour runs them", async () => {
    // Sunday's first run is the week's biggest catch-up: it ran right up to the start-by line.
    const h = harness({ now: () => RUN_START + WEEKLY_START_BY_MS });
    const spam = job("spam");
    const retro = job("retro");
    await runWeeklyJobs(h.deps, [spam.job, retro.job]);
    expect(spam.deadlines).toEqual([]);
    expect(retro.deadlines).toEqual([]);
    expect(h.sent).toEqual([]);
    expect(await h.deps.runs.get(1, "spam")).toBeNull();
    expect(await h.deps.runs.get(1, "retro")).toBeNull();

    const next = harness({ runs: h.deps.runs, runStart: RUN_START + HOUR, now: () => RUN_START + HOUR + 1_000 });
    await runWeeklyJobs(next.deps, [spam.job, retro.job]);
    expect(next.sent.map(s => s.text)).toEqual(["spam report", "retro report"]);
    expect(await next.deps.runs.get(1, "spam")).toBe(WEEK);
    expect(await next.deps.runs.get(1, "retro")).toBe(WEEK);
  });

  it("starts a job just inside the line and hands it the work deadline (runStart + 270s)", async () => {
    const h = harness({ now: () => RUN_START + WEEKLY_START_BY_MS - 1 });
    const spam = job("spam");
    await runWeeklyJobs(h.deps, [spam.job]);
    expect(spam.deadlines).toEqual([RUN_START + WEEKLY_DEADLINE_MS]);
  });

  it("does not start the second job once the first has run past the start-by line", async () => {
    let clock = RUN_START + 200_000;
    const h = harness({ now: () => clock });
    const spam = job("spam", {}, async () => { clock = RUN_START + WEEKLY_START_BY_MS + 5_000; });
    const retro = job("retro");
    await runWeeklyJobs(h.deps, [spam.job, retro.job]);
    expect(h.sent.map(s => s.text)).toEqual(["spam report"]);
    expect(retro.deadlines).toEqual([]);
    expect(await h.deps.runs.get(1, "retro")).toBeNull(); // the next hour runs it
  });

  it("sends with the report's silence, saves its refs under the sent message id in order, THEN sets the key", async () => {
    const events: string[] = [];
    const runs = fakeWeeklyRunRepo();
    const h = harness({
      runs: { get: runs.get, async set(u, k, w) { events.push(`set:${k}`); await runs.set(u, k, w); } },
      send: async (_text, opts) => { events.push(`send:${opts.silent}`); return 777; },
      saveRefs: async (messageId, refs) => { events.push(`refs:${messageId}:${refs.map(r => r.id).join(",")}`); },
    });
    const refs = [
      { id: "s2", from: "b@x.com", subject: "B", kind: "spam" },
      { id: "s1", from: "a@x.com", subject: "A", kind: "spam" },
    ];
    await runWeeklyJobs(h.deps, [job("spam", { silent: false, refs }).job]);
    expect(events).toEqual(["send:false", "refs:777:s2,s1", "set:spam"]);
  });

  it("still records the week when only the refs fail to save (the report was delivered)", async () => {
    const h = harness({ saveRefs: async () => { throw new Error("db down"); } });
    await runWeeklyJobs(h.deps, [job("spam", { refs: [{ id: "s1", from: "a", subject: "A", kind: "spam" }] }).job]);
    expect(h.sent).toHaveLength(1);
    expect(await h.deps.runs.get(1, "spam")).toBe(WEEK);
  });

  it("skips the refs save when the report has none", async () => {
    const h = harness();
    await runWeeklyJobs(h.deps, [job("spam").job]);
    expect(h.saved).toEqual([]);
  });

  it("never throws, even when the run store itself fails", async () => {
    const h = harness({ runs: { async get() { throw new Error("db down"); }, async set() { throw new Error("db down"); } } });
    await expect(runWeeklyJobs(h.deps, [job("spam").job, job("retro").job])).resolves.toBeUndefined();
    expect(h.sent).toEqual([]);
  });
});
