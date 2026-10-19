// tests/weekly/second-look.test.ts
import { describe, it, expect } from "vitest";
import { secondLook, SECOND_LOOK_CAP, SECOND_LOOK_BATCH } from "../../src/weekly/second-look.js";
import type { WeekFacts } from "../../src/weekly/gather.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { fakeLLM, parseActedJson, type LLMProvider, type ActedCandidate, type ActedVerdict } from "../../src/llm/provider.js";
import type { ActedSource } from "../../src/notifier/activity.js";

const T = new Date("2026-10-26T06:00:00Z").getTime();

function raw(id: string, from: string, subject: string, labelIds: string[] = ["TRASH"], snippet = "") {
  return { id, threadId: "t", snippet, labelIds, payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] } };
}
function facts(acted: WeekFacts["acted"]): WeekFacts {
  return { acted, rescued: 0, undone: 0, rulesNew: 0, rulesChanged: 0, ops: [] };
}
// One activity row; `minute` orders them (facts.acted is oldest first).
function acted(messageId: string | undefined, action: "trashed" | "archived", source: ActedSource | undefined, minute: number): WeekFacts["acted"][number] {
  return { ...(messageId ? { messageId } : {}), from: "logged@x.com", subject: "as logged", action, ...(source ? { source } : {}), at: new Date(T + minute * 60_000) };
}
function judging(fn: (items: ActedCandidate[]) => { verdicts: ActedVerdict[]; unjudged: number }, calls: ActedCandidate[][] = []): LLMProvider {
  return { ...fakeLLM(() => ({ important: false, suspicious: false, reason: "" })),
    async reviewActed(items) { calls.push(items); return fn(items); } };
}
const allFine = judging(items => ({ verdicts: items.map(i => ({ id: i.id, looksWrong: false, reason: "routine" })), unjudged: 0 }));
const noDeadline = { deadline: Number.POSITIVE_INFINITY, now: () => 0 };
// The shape googleapis throws for an HTTP error (a GaxiosError).
function gaxiosError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status, response: { status, data: { error: { code: status, message } } } });
}

describe("secondLook", () => {
  it("re-checks each acted message by id, newest first, with sender/subject/snippet/attachments from Gmail and the action + why", async () => {
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: {
      inv: { id: "inv", threadId: "t", snippet: "Your invoice is attached", labelIds: ["TRASH"], payload: {
        mimeType: "multipart/mixed",
        headers: [{ name: "From", value: "Acme <billing@acme.com>" }, { name: "Subject", value: "Invoice 4821" }],
        parts: [{ partId: "1", mimeType: "application/pdf", filename: "invoice.pdf", body: { attachmentId: "att1", size: 120 * 1024 } }],
      } },
      news: raw("news", "news@list.com", "Weekly", []),
      back: raw("back", "jane@x.com", "Lunch", ["INBOX"]),
    } });
    const calls: ActedCandidate[][] = [];
    const llm = judging(items => ({ verdicts: items.map(i => ({ id: i.id, looksWrong: i.id === "inv", reason: i.id === "inv" ? "a real invoice" : "routine" })), unjudged: 0 }), calls);
    const look = await secondLook(facts([
      acted("inv", "trashed", "plain", 1),
      acted(undefined, "trashed", undefined, 2),  // logged before 0018: no id, so it can't be re-checked
      acted("news", "archived", "guarded", 3),
      acted("back", "trashed", "chat", 4),         // already back in the inbox (restored or undone)
    ]), { gmail, llm, ...noDeadline });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.map(c => c.id)).toEqual(["news", "inv"]);
    expect(calls[0]![1]).toMatchObject({ id: "inv", from: "Acme <billing@acme.com>", subject: "Invoice 4821", snippet: "Your invoice is attached",
      action: "trashed", why: "a sender rule (acted on without reading the body)" });
    expect(calls[0]![1]!.attachmentLine).toContain("invoice.pdf");
    expect(calls[0]![0]).toMatchObject({ id: "news", action: "archived", why: "a guarded sender rule (body read and judged first)" });
    expect(calls[0]![0]).not.toHaveProperty("attachmentLine");
    expect(look).toEqual({
      flagged: [{ id: "inv", from: "Acme <billing@acme.com>", subject: "Invoice 4821", action: "trashed", reason: "a real invoice" }],
      unjudged: 0, skippedGone: 0, capped: false, incomplete: false,
    });
  });

  it("judges 'back' by the action: a trashed message still carrying INBOX next to TRASH IS re-checked; untrashed or un-archived ones are not", async () => {
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: {
      both: raw("both", "dana@x.com", "Re: lease", ["INBOX", "TRASH"]),
      untrashed: raw("untrashed", "a@x.com", "Hi", []),
      unarchived: raw("unarchived", "b@x.com", "Yo", ["INBOX"]),
    } });
    const calls: ActedCandidate[][] = [];
    await secondLook(facts([acted("both", "trashed", "plain", 1), acted("untrashed", "trashed", "chat", 2), acted("unarchived", "archived", "guarded", 3)]),
      { gmail, llm: judging(items => ({ verdicts: [], unjudged: items.length }), calls), ...noDeadline });
    expect(calls.flat().map(c => c.id)).toEqual(["both"]);
  });

  it("checks a message acted on twice once, as its latest action", async () => {
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: { m: raw("m", "a@x.com", "Hi") } });
    const calls: ActedCandidate[][] = [];
    await secondLook(facts([acted("m", "archived", "plain", 1), acted("m", "trashed", "chat", 2)]),
      { gmail, llm: judging(items => ({ verdicts: [], unjudged: items.length }), calls), ...noDeadline });
    expect(calls[0]!.map(c => [c.id, c.action, c.why])).toEqual([["m", "trashed", "the owner asked in chat"]]);
  });

  it("skips and counts a message deleted for good (404); any other fetch failure is counted as couldn't re-check", async () => {
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: { ok: raw("ok", "a@x.com", "fine") } });
    const orig = gmail.getMeta.bind(gmail);
    gmail.getMeta = async (id: string) => {
      if (id === "gone") throw gaxiosError(404, "Requested entity was not found.");
      if (id === "flaky") throw gaxiosError(500, "Backend Error");
      return orig(id);
    };
    const look = await secondLook(facts([acted("ok", "trashed", "plain", 1), acted("gone", "trashed", "plain", 2), acted("flaky", "archived", "pref", 3)]),
      { gmail, llm: allFine, ...noDeadline });
    expect(look).toEqual({ flagged: [], unjudged: 1, skippedGone: 1, capped: false, incomplete: false });
  });

  it("never flags what the model left out, garbled or answered for an id it wasn't given — those count as couldn't re-check (Review Focus 5)", async () => {
    const ids = ["a", "b", "c", "d"];
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: Object.fromEntries(ids.map(id => [id, raw(id, "a@x.com", id)])) });
    const partial = judging(() => ({ verdicts: [{ id: "a", looksWrong: true, reason: "a person" }, { id: "zzz", looksWrong: true, reason: "not ours" }], unjudged: 0 }));
    const look = await secondLook(facts(ids.map((id, i) => acted(id, "trashed", "plain", i))), { gmail, llm: partial, ...noDeadline });
    expect(look.flagged.map(f => f.id)).toEqual(["a"]);
    expect(look.unjudged).toBe(3);

    const garbled = judging(items => parseActedJson("```json\n[{oops", items.map(i => i.id)));
    const look2 = await secondLook(facts(ids.map((id, i) => acted(id, "trashed", "plain", i))), { gmail, llm: garbled, ...noDeadline });
    expect(look2).toEqual({ flagged: [], unjudged: 4, skippedGone: 0, capped: false, incomplete: false });
  });

  it("a batch whose review call throws is counted as couldn't re-check, and the look still completes", async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `m${i}`);
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: Object.fromEntries(ids.map(id => [id, raw(id, "a@x.com", id)])) });
    let call = 0;
    const llm: LLMProvider = { ...fakeLLM(() => ({ important: false, suspicious: false, reason: "" })),
      async reviewActed(items) {
        if (++call === 1) throw new Error("gemini 504");
        return { verdicts: items.map(i => ({ id: i.id, looksWrong: i.id === "m0", reason: "a person" })), unjudged: 0 };
      } };
    const look = await secondLook(facts(ids.map((id, i) => acted(id, "trashed", "plain", i))), { gmail, llm, ...noDeadline });
    expect(look).toEqual({ flagged: [{ id: "m0", from: "a@x.com", subject: "m0", action: "trashed", reason: "a person" }],
      unjudged: 40, skippedGone: 0, capped: false, incomplete: false });
  });

  // Spec B §1 / C: a failed run retries next hour; an outage must never become a clean
  // "nothing looks wrong" with the week's key set.
  it("throws when every review call fails", async () => {
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: { a: raw("a", "a@x.com", "a") } });
    const llm: LLMProvider = { ...fakeLLM(() => ({ important: false, suspicious: false, reason: "" })), async reviewActed() { throw new Error("gemini 504"); } };
    await expect(secondLook(facts([acted("a", "trashed", "plain", 1)]), { gmail, llm, ...noDeadline }))
      .rejects.toThrow("second look: no batch could be judged");
  });

  it("throws when no message could be read at all", async () => {
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: {} });
    gmail.getMeta = async () => { throw gaxiosError(500, "Backend Error"); };
    const calls: ActedCandidate[][] = [];
    await expect(secondLook(facts([acted("a", "trashed", "plain", 1), acted("b", "archived", "pref", 2)]), { gmail, llm: judging(() => ({ verdicts: [], unjudged: 0 }), calls), ...noDeadline }))
      .rejects.toThrow("second look: no message could be read");
    expect(calls).toEqual([]);
  });

  it("is not a failure when everything acted on is gone for good or already back", async () => {
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: { back: raw("back", "a@x.com", "Hi", ["INBOX"]) } });
    const orig = gmail.getMeta.bind(gmail);
    gmail.getMeta = async (id: string) => { if (id === "gone") throw gaxiosError(404, "Requested entity was not found."); return orig(id); };
    const look = await secondLook(facts([acted("gone", "trashed", "plain", 1), acted("back", "trashed", "chat", 2)]), { gmail, llm: allFine, ...noDeadline });
    expect(look).toEqual({ flagged: [], unjudged: 0, skippedGone: 1, capped: false, incomplete: false });
  });

  it("re-checks at most 300 — the newest — and reports the rest as capped", async () => {
    const ids = Array.from({ length: 301 }, (_, i) => `m${i}`);
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: Object.fromEntries(ids.map(id => [id, raw(id, "a@x.com", id)])) });
    const fetched: string[] = [];
    const orig = gmail.getMeta.bind(gmail);
    gmail.getMeta = async (id: string) => { fetched.push(id); return orig(id); };
    const look = await secondLook(facts(ids.map((id, i) => acted(id, "trashed", "plain", i))), { gmail, llm: allFine, ...noDeadline });
    expect(SECOND_LOOK_CAP).toBe(300);
    expect(fetched).toHaveLength(300);
    expect(fetched).not.toContain("m0"); // the oldest is the one left out
    expect(look).toMatchObject({ capped: true, unjudged: 0, incomplete: false });
  });

  it("judges in batches of 40", async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `m${i}`);
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: Object.fromEntries(ids.map(id => [id, raw(id, "a@x.com", id)])) });
    const calls: ActedCandidate[][] = [];
    await secondLook(facts(ids.map((id, i) => acted(id, "trashed", "plain", i))),
      { gmail, llm: judging(items => ({ verdicts: items.map(i => ({ id: i.id, looksWrong: false, reason: "" })), unjudged: 0 }), calls), ...noDeadline });
    expect(SECOND_LOOK_BATCH).toBe(40);
    expect(calls.map(c => c.length)).toEqual([40, 5]);
  });

  it("stops fetching at the deadline: incomplete, and what it didn't judge is counted", async () => {
    const ids = ["a", "b", "c", "d", "e"];
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: Object.fromEntries(ids.map(id => [id, raw(id, "a@x.com", id)])) });
    let t = 0;
    const orig = gmail.getMeta.bind(gmail);
    gmail.getMeta = async (id: string) => { t += 10; return orig(id); }; // each fetch costs 10ms of the budget
    const calls: ActedCandidate[][] = [];
    const fetched: string[] = [];
    const counted = gmail.getMeta;
    gmail.getMeta = async (id: string) => { fetched.push(id); return counted(id); };
    await expect(secondLook(facts(ids.map((id, i) => acted(id, "trashed", "plain", i))),
      { gmail, llm: judging(items => ({ verdicts: [], unjudged: items.length }), calls), deadline: 25, now: () => t }))
      .rejects.toThrow("second look: no batch could be judged"); // read some, judged none: not a report
    expect(fetched).toHaveLength(3); // the fetches stopped at the deadline
    expect(calls).toHaveLength(0); // past the deadline before any batch could start
  });

  it("stops between batches at the deadline: the unsent batch is counted, the judged one kept", async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `m${i}`);
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: Object.fromEntries(ids.map(id => [id, raw(id, "a@x.com", id)])) });
    let t = 0;
    const calls: ActedCandidate[][] = [];
    const slow = judging(items => { t += 200; return { verdicts: items.map(i => ({ id: i.id, looksWrong: i.id === "m44", reason: "a person" })), unjudged: 0 }; }, calls);
    const look = await secondLook(facts(ids.map((id, i) => acted(id, "trashed", "plain", i))), { gmail, llm: slow, deadline: 100, now: () => t });
    expect(calls).toHaveLength(1);
    expect(look).toMatchObject({ unjudged: 5, incomplete: true });
    expect(look.flagged.map(f => f.id)).toEqual(["m44"]); // newest first, so m44 was in the first batch
  });

  it("stops waiting for a review call that outlives the deadline: incomplete, that batch counted as couldn't re-check", async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `m${i}`);
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: Object.fromEntries(ids.map(id => [id, raw(id, "a@x.com", id)])) });
    let call = 0;
    const hungSecond: LLMProvider = { ...fakeLLM(() => ({ important: false, suspicious: false, reason: "" })),
      reviewActed: (items) => ++call === 1
        ? Promise.resolve({ verdicts: items.map(i => ({ id: i.id, looksWrong: false, reason: "" })), unjudged: 0 })
        : new Promise<never>(() => {}) };
    const look = await secondLook(facts(ids.map((id, i) => acted(id, "trashed", "plain", i))), { gmail, llm: hungSecond, deadline: 20, now: () => 0 });
    expect(look).toEqual({ flagged: [], unjudged: 5, skippedGone: 0, capped: false, incomplete: true });
  });

  it("a lone review call that outlives the deadline fails the look (nothing was judged)", async () => {
    const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: { a: raw("a", "a@x.com", "a") } });
    const hung: LLMProvider = { ...fakeLLM(() => ({ important: false, suspicious: false, reason: "" })), reviewActed: () => new Promise<never>(() => {}) };
    await expect(secondLook(facts([acted("a", "trashed", "plain", 1)]), { gmail, llm: hung, deadline: 20, now: () => 0 }))
      .rejects.toThrow("second look: no batch could be judged");
  });
});
