// tests/weekly/retro.test.ts
// The "retro" weekly kind end to end, through runWeeklyTasks with repo fakes: gather →
// second look → report → send → refs → week key, plus the reply that restores.
import { describe, it, expect } from "vitest";
import { runWeeklyTasks, type WeeklyDeps } from "../../src/weekly/run.js";
import { fakeWeeklyRunRepo } from "../../src/weekly/runs.js";
import { weekKey } from "../../src/weekly/week.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeLLM, type LLMProvider, type AgentStep } from "../../src/llm/provider.js";
import { fakeActivityRepo } from "../../src/notifier/activity.js";
import { fakeActionLogRepo, fakeProposalRepo, type ActionLogRepo, type ActionLogEntry } from "../../src/cleanup/proposals.js";
import { fakeOpsEventRepo } from "../../src/ops/events.js";
import { fakeDigestRefRepo } from "../../src/notifier/refs.js";
import { handleMessage, type SecretaryDeps } from "../../src/telegram/bot.js";
import { fakeConversationRepo } from "../../src/conversation/store.js";
import { readOnlyTools } from "../../src/agent/tools.js";
import { trashTools } from "../../src/cleanup/tools.js";

const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-11-01T06:00:00Z").getTime(); // Sunday 08:00 in Jerusalem
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const noLLM = () => ({ important: false, suspicious: false, reason: "" });

function raw(id: string, from: string, subject: string, labelIds: string[]) {
  return { id, threadId: "t", snippet: "", labelIds, payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] } };
}

async function setup(over: Partial<WeeklyDeps> = {}) {
  let clockMs = NOW - 5 * DAY;
  const clock = () => new Date(clockMs);
  const activity = fakeActivityRepo(clock);
  await activity.record(1, [
    { action: "trashed", from: "Acme <billing@acme.com>", subject: "Invoice 4821", messageId: "t1", source: "plain" },
    { action: "trashed", from: "promo@shop.com", subject: "Sale", messageId: "t2", source: "plain" },
    { action: "archived", from: "news@list.com", subject: "Weekly", messageId: "a1", source: "guarded" },
  ]);
  const ops = fakeOpsEventRepo(clock);
  await ops.record(1, "poll_incomplete", { processed: 40, remaining: 12 });
  clockMs = NOW - 40 * DAY;
  await ops.record(1, "cursor_expired"); // older than 30 days: the retro run prunes it
  const runs = fakeWeeklyRunRepo();
  await runs.set(1, "spam", weekKey(new Date(NOW), TZ)); // this week's spam check already went out
  const refs = fakeDigestRefRepo();
  const sent: { text: string; silent: boolean }[] = [];
  const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: {
    t1: raw("t1", "Acme <billing@acme.com>", "Invoice 4821", ["TRASH"]),
    t2: raw("t2", "promo@shop.com", "Sale", ["TRASH"]),
    a1: raw("a1", "news@list.com", "Weekly", []),
  } });
  const llm: LLMProvider = { ...fakeLLM(noLLM),
    async reviewActed(items) {
      return { verdicts: items.map(i => ({ id: i.id, looksWrong: i.id === "t1", reason: i.id === "t1" ? "looks like a real invoice" : "routine" })), unjudged: 0 };
    } };
  const actionLog: ActionLogRepo = { ...fakeActionLogRepo(), async runsSince(): Promise<ActionLogEntry[]> {
    return [{ runId: "r1", messageIds: ["s1", "s2"], action: "unspam", at: new Date(NOW - 2 * DAY), undoneAt: null }];
  } };
  const deps: WeeklyDeps = {
    userId: 1, chatId: 555, timezone: TZ, language: "en", now: () => NOW, runStart: NOW - 5_000,
    gmail, llm, store: inMemoryStore(), runs,
    send: async (text, opts) => { sent.push({ text, silent: opts.silent }); return 777; },
    saveRefs: (messageId, r) => refs.save(1, messageId, r),
    activity, actionLog, ops,
    ...over,
  };
  return { deps, sent, refs, runs, ops, gmail };
}

describe("weekly retro kind", () => {
  it("sends the week in review, saves its refs in report order, marks the week, and prunes ops events past 30 days", async () => {
    const { deps, sent, refs, runs, ops } = await setup();
    await runWeeklyTasks(deps);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("🗓 Week in review: trashed 2 · archived 1 · rescued from spam 2 · undone 0 · rules +0");
    expect(sent[0]!.text).toContain("1. trashed — Acme <billing[at]acme[.]com> — Invoice 4821 (looks like a real invoice)");
    expect(sent[0]!.text).toContain("🛠 Ops:");
    expect(sent[0]!.silent).toBe(false);
    expect(await refs.lookup(1, 777)).toEqual([{ id: "t1", from: "Acme <billing@acme.com>", subject: "Invoice 4821", kind: "trashed" }]);
    expect(await runs.get(1, "retro")).toBe(weekKey(new Date(NOW), TZ));
    expect(ops.all(1).map(e => e.kind)).toEqual(["poll_incomplete"]);
  });

  it("runs once per week", async () => {
    const { deps, sent } = await setup();
    await runWeeklyTasks(deps);
    await runWeeklyTasks(deps);
    expect(sent).toHaveLength(1);
  });

  it("an outage in the second look (every review call fails) sends nothing and leaves the week unmarked", async () => {
    const llm: LLMProvider = { ...fakeLLM(noLLM), async reviewActed() { throw new Error("503 UNAVAILABLE"); } };
    const { deps, sent, runs, ops } = await setup({ llm });
    await runWeeklyTasks(deps);
    expect(sent).toEqual([]);
    expect(await runs.get(1, "retro")).toBeNull();
    expect(ops.all(1).filter(e => e.kind === "weekly_failed").map(e => e.detail?.kind)).toEqual(["retro"]); // one attempt used
  });

  it("without its repos it sends nothing and leaves the week unmarked, so the next hour retries", async () => {
    const { deps, sent, runs } = await setup({ activity: undefined });
    await runWeeklyTasks(deps);
    expect(sent).toEqual([]);
    expect(await runs.get(1, "retro")).toBeNull();
  });

  it("a reply 'restore 1' resolves through the saved refs to restore_messages on exactly that id", async () => {
    const { deps, refs, gmail } = await setup();
    await runWeeklyTasks(deps);
    let step = 0;
    // A scripted model that does what the prompt asks: map "1" to the [1] ref's id.
    const agent: LLMProvider = { ...fakeLLM(noLLM),
      async agentStep(messages): Promise<AgentStep> {
        step++;
        if (step === 1) {
          const m = JSON.stringify(messages.at(-1)).match(/\[1\] id=([^\s\\"]+)/);
          return { kind: "tool_calls", calls: [{ name: "restore_messages", args: { ids: m ? [m[1]!] : [] } }] };
        }
        return { kind: "final", text: "Restored." };
      } };
    const chat: SecretaryDeps = { userId: 1, gmail, memory: inMemoryStore(), llm: agent, convo: fakeConversationRepo(),
      proposals: fakeProposalRepo(), actionLog: fakeActionLogRepo(), tools: [...readOnlyTools(), ...trashTools()],
      replyRefs: (await refs.lookup(1, 777)) ?? undefined };
    await handleMessage("restore 1", chat);
    expect(gmail.restoredIds!()).toEqual(["t1"]);
  });
});
