// tests/weekly/run.spam.test.ts
// The spam check wired into the weekly runner: judged, sent, coupled to its refs, THEN keyed.
import { describe, it, expect } from "vitest";
import { runWeeklyTasks, type WeeklyDeps } from "../../src/weekly/run.js";
import { fakeWeeklyRunRepo } from "../../src/weekly/runs.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import type { GmailRawMessage } from "../../src/gmail/headers.js";
import { fakeLLM, type LLMProvider, type SpamCandidate, type SpamVerdict } from "../../src/llm/provider.js";
import { inMemoryStore } from "../../src/memory/store.js";
import type { DigestRef } from "../../src/notifier/refs.js";

const HOUR = 3_600_000;
const RUN_START = Date.parse("2026-10-18T06:00:00Z"); // Sunday 09:00 in Jerusalem
const WEEK = "2026-10-18";

const raw = (id: string, from: string, subject: string): GmailRawMessage =>
  ({ id, threadId: id, snippet: "", labelIds: ["SPAM"], payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] } });

function harness(opts: { legit?: string[]; send?: WeeklyDeps["send"]; runs?: WeeklyDeps["runs"]; runStart?: number; reviewSpam?: LLMProvider["reviewSpam"] } = {}) {
  const events: string[] = [];
  const sent: { text: string; silent: boolean }[] = [];
  const saved: { messageId: number; refs: DigestRef[] }[] = [];
  const msgs = [raw("s1", "Dana <dana@x.com>", "Re: dinner"), raw("s2", "promo@deals.biz", "Sale")];
  const legit = new Set(opts.legit ?? []);
  const llm: LLMProvider = {
    ...fakeLLM(() => ({ important: false, suspicious: false, reason: "" })),
    async reviewSpam(c: SpamCandidate[]) {
      const verdicts: SpamVerdict[] = c.map(x => ({ id: x.id, legitimate: legit.has(x.id), suspicious: false, reason: legit.has(x.id) ? "a personal reply" : "marketing" }));
      return { verdicts, unjudged: 0 };
    },
    ...(opts.reviewSpam ? { reviewSpam: opts.reviewSpam } : {}),
  };
  const runs = opts.runs ?? fakeWeeklyRunRepo();
  const runStart = opts.runStart ?? RUN_START;
  const deps: WeeklyDeps = {
    userId: 1, chatId: 555, timezone: "Asia/Jerusalem", language: "en",
    runStart, now: () => runStart + 200_000,
    gmail: fakeGmailClient({ historyId: "1", addedSince: {}, messages: Object.fromEntries(msgs.map(m => [m.id, m])), spam: msgs.map(m => m.id) }),
    llm, store: inMemoryStore(),
    runs: { get: runs.get, async set(u, k, w) { events.push(`set:${k}`); await runs.set(u, k, w); } },
    send: opts.send ?? (async (text, o) => { events.push("send"); sent.push({ text, silent: o.silent }); return 900 + sent.length; }),
    saveRefs: async (messageId, refs) => { events.push("refs"); saved.push({ messageId, refs }); },
  };
  return { deps, events, sent, saved, runs };
}
const spamReports = (sent: { text: string }[]) => sent.filter(s => s.text.startsWith("🧹"));

describe("weekly spam check, wired", () => {
  it("sends the report, saves its refs in report order under the sent message, THEN sets the key", async () => {
    const h = harness({ legit: ["s1"] });
    await runWeeklyTasks(h.deps);
    expect(h.sent[0]).toEqual({ text: [
      "🧹 Spam check (last 7 days): 2 in spam, 1 looks legitimate:",
      "1. Dana <dana[at]x[.]com> — Re: dinner (a personal reply)",
      'Reply "rescue 1 3" or "rescue all".',
    ].join("\n"), silent: false });
    expect(h.saved[0]).toEqual({ messageId: 901, refs: [{ id: "s1", from: "Dana <dana@x.com>", subject: "Re: dinner", kind: "spam" }] });
    expect(h.events.slice(0, 3)).toEqual(["send", "refs", "set:spam"]);
    expect(await h.runs.get(1, "spam")).toBe(WEEK);
  });

  it("runs once a week: the next hour sends no second spam report", async () => {
    const h = harness({ legit: ["s1"] });
    await runWeeklyTasks(h.deps);
    const next = harness({ legit: ["s1"], runs: h.runs, runStart: RUN_START + HOUR });
    await runWeeklyTasks(next.deps);
    expect(spamReports(h.sent)).toHaveLength(1);
    expect(spamReports(next.sent)).toHaveLength(0);
  });

  it("nothing legitimate: a silent one-liner, no refs saved, and the week still counts", async () => {
    const h = harness();
    await runWeeklyTasks(h.deps);
    expect(h.sent[0]).toEqual({ text: "🧹 Spam check: 2 in spam, nothing looks legitimate.", silent: true });
    expect(h.saved).toEqual([]);
    expect(await h.runs.get(1, "spam")).toBe(WEEK);
  });

  it("a failed send leaves the key unset, so the next hour sends it", async () => {
    const h = harness({ legit: ["s1"], send: async () => { throw new Error("telegram 502"); } });
    await runWeeklyTasks(h.deps);
    expect(await h.runs.get(1, "spam")).toBeNull();
    const next = harness({ legit: ["s1"], runs: h.runs, runStart: RUN_START + HOUR });
    await runWeeklyTasks(next.deps);
    expect(spamReports(next.sent)).toHaveLength(1);
    expect(await h.runs.get(1, "spam")).toBe(WEEK);
  });
});

describe("weekly spam check, wired — an outage", () => {
  it("a model that always fails sends nothing and leaves the key unset, so the next hour retries", async () => {
    const h = harness({ reviewSpam: async () => { throw new Error("503 UNAVAILABLE"); } });
    await runWeeklyTasks(h.deps);
    expect(spamReports(h.sent)).toEqual([]);
    expect(await h.runs.get(1, "spam")).toBeNull();

    const next = harness({ legit: ["s1"], runs: h.runs, runStart: RUN_START + HOUR });
    await runWeeklyTasks(next.deps);
    expect(spamReports(next.sent)).toHaveLength(1);
    expect(await h.runs.get(1, "spam")).toBe(WEEK);
  });
});
