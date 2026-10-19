// tests/weekly/spam.test.ts
import { describe, it, expect } from "vitest";
import { checkSpam, SPAM_SCAN_CAP } from "../../src/weekly/spam.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import type { GmailRawMessage } from "../../src/gmail/headers.js";
import { inMemoryStore, type MemoryRow } from "../../src/memory/store.js";
import { fakeLLM, parseSpamJson, type LLMProvider, type SpamCandidate, type SpamVerdict } from "../../src/llm/provider.js";

const NOW = 1_000_000;
const DEADLINE = NOW + 60_000;

function raw(id: string, from: string, subject: string, extra: Partial<GmailRawMessage> = {}): GmailRawMessage {
  return { id, threadId: id, snippet: `snippet ${id}`, labelIds: ["SPAM"], payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] }, ...extra };
}
function spamFolder(msgs: GmailRawMessage[]) {
  return fakeGmailClient({ historyId: "1", addedSince: {}, messages: Object.fromEntries(msgs.map(m => [m.id, m])), spam: msgs.map(m => m.id) });
}
function many(n: number, prefix = "u") {
  return Array.from({ length: n }, (_, i) => raw(`${prefix}${i + 1}`, `promo${i + 1}@deals.biz`, `Deal ${i + 1}`));
}
// A spam reviewer scripted per batch; records every batch it was given.
function reviewer(judge: (c: SpamCandidate[]) => { verdicts: SpamVerdict[]; unjudged: number } | Promise<{ verdicts: SpamVerdict[]; unjudged: number }>) {
  const batches: SpamCandidate[][] = [];
  const llm: LLMProvider = {
    ...fakeLLM(() => ({ important: false, suspicious: false, reason: "" })),
    async reviewSpam(c) { batches.push(c); return judge(c); },
  };
  return { llm, batches };
}
const nothingLegit = (c: SpamCandidate[]) => ({ verdicts: c.map(x => ({ id: x.id, legitimate: false, suspicious: false, reason: "junk" })), unjudged: 0 });
const rule = (over: Partial<MemoryRow>): MemoryRow =>
  ({ userId: 1, slug: "", description: "", body: "", scope: "sender", matchType: "sender", matchValue: "", verdict: "important", action: null, ...over });

describe("checkSpam", () => {
  // Spam is where forged From headers land (SPF/DKIM failures): a rule for the sender is
  // no proof the mail is from them. Rule-matched mail is still flagged ("you have a rule
  // for this sender"), but it goes to the model too, which judges whether it's phishing.
  it("flags a sender the owner ruled important or keep, and still has the model check it for phishing", async () => {
    const gmail = spamFolder([
      raw("d1", "Dana <dana@x.com>", "Re: dinner"),
      raw("k1", "Shop <orders@shop.com>", "Your order"),
      raw("j1", "Junk <a@junk.com>", "Buy now"),
      raw("u1", "Unknown <who@else.com>", "Hello"),
    ]);
    const store = inMemoryStore([
      rule({ slug: "sender:dana@x.com", matchValue: "dana@x.com", verdict: "important" }),
      rule({ slug: "domain:shop.com", scope: "domain", matchType: "domain", matchValue: "shop.com", verdict: "unimportant", action: "keep" }),
      rule({ slug: "domain:junk.com", scope: "domain", matchType: "domain", matchValue: "junk.com", verdict: "unimportant", action: "trash" }),
    ]);
    const { llm, batches } = reviewer(nothingLegit);
    const r = await checkSpam({ gmail, llm, store, deadline: DEADLINE, now: () => NOW });
    expect(batches.map(b => b.map(c => c.id))).toEqual([["d1", "k1", "j1", "u1"]]);
    // Flagged whatever the model says about legitimacy; a trash rule is no reason to flag.
    expect(r.flagged).toEqual([
      { id: "d1", from: "Dana <dana@x.com>", subject: "Re: dinner", reason: "rule:sender:dana@x.com", suspicious: false, byRule: true },
      { id: "k1", from: "Shop <orders@shop.com>", subject: "Your order", reason: "rule:domain:shop.com", suspicious: false, byRule: true },
    ]);
    expect(r).toMatchObject({ total: 4, judged: 4, unjudged: 0, capped: false, incomplete: false });
  });

  it("takes a rule-matched message's phishing mark from the model", async () => {
    const gmail = spamFolder([raw("d1", "Dana <dana@x.com>", "Urgent: wire the deposit today"), raw("d2", "Dana <dana@x.com>", "Re: dinner")]);
    const { llm } = reviewer(() => ({ verdicts: [
      { id: "d1", legitimate: false, suspicious: true, reason: "spoofed sender asking for money" },
      { id: "d2", legitimate: true, suspicious: false, reason: "a personal reply" },
    ], unjudged: 0 }));
    const r = await checkSpam({ gmail, llm, store: inMemoryStore([rule({ slug: "sender:dana@x.com", matchValue: "dana@x.com" })]), deadline: DEADLINE, now: () => NOW });
    expect(r.flagged.map(f => [f.id, f.byRule, f.suspicious])).toEqual([["d1", true, true], ["d2", true, false]]);
  });

  it("a rule-matched message the model couldn't judge is marked suspicious — missing, malformed, failed batch or cut by the deadline", async () => {
    const store = inMemoryStore([rule({ slug: "sender:dana@x.com", matchValue: "dana@x.com" })]);
    const ruled = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => raw(`${prefix}${i + 1}`, "Dana <dana@x.com>", `Hi ${i + 1}`));

    // Left out of the model's answer, or a verdict that isn't a real boolean.
    const sloppy = reviewer(c => parseSpamJson(JSON.stringify([{ id: c[1]!.id, legitimate: "yes" }, { id: c[2]!.id, legitimate: true, suspicious: false, reason: "ok" }]), c.map(x => x.id)));
    const r1 = await checkSpam({ gmail: spamFolder(ruled(3, "d")), llm: sloppy.llm, store, deadline: DEADLINE, now: () => NOW });
    expect(r1.flagged.map(f => [f.id, f.suspicious])).toEqual([["d1", true], ["d2", true], ["d3", false]]);
    expect(r1.unjudged).toBe(2);

    // A failed batch (another batch came back, so the check still reports).
    let call = 0;
    const flaky = reviewer(c => {
      if (++call === 1) throw new Error("504 DEADLINE_EXCEEDED");
      return nothingLegit(c);
    });
    const r2 = await checkSpam({ gmail: spamFolder([...ruled(1, "d"), ...many(44)]), llm: flaky.llm, store, deadline: DEADLINE, now: () => NOW });
    expect(r2.flagged).toEqual([{ id: "d1", from: "Dana <dana@x.com>", subject: "Hi 1", reason: "rule:sender:dana@x.com", suspicious: true, byRule: true }]);

    // Cut by the deadline before its batch was judged.
    let clock = NOW;
    const slow = reviewer(c => { clock = DEADLINE; return nothingLegit(c); });
    const r3 = await checkSpam({ gmail: spamFolder([...many(40), ...ruled(1, "d")]), llm: slow.llm, store, deadline: DEADLINE, now: () => clock });
    expect(slow.batches).toHaveLength(1);
    expect(r3.incomplete).toBe(true);
    expect(r3.flagged).toEqual([{ id: "d1", from: "Dana <dana@x.com>", subject: "Hi 1", reason: "rule:sender:dana@x.com", suspicious: true, byRule: true }]);
  });

  it("rule-matched messages count as candidates: when no batch comes back, the check fails rather than report", async () => {
    const { llm, batches } = reviewer(() => { throw new Error("503 UNAVAILABLE"); });
    const store = inMemoryStore([rule({ slug: "sender:dana@x.com", matchValue: "dana@x.com" })]);
    await expect(checkSpam({ gmail: spamFolder([raw("d1", "dana@x.com", "Hi")]), llm, store, deadline: DEADLINE, now: () => NOW }))
      .rejects.toThrow("spam check: no batch could be judged");
    expect(batches.map(b => b.map(c => c.id))).toEqual([["d1"]]);
  });

  it("flags only an explicit legitimate verdict, carrying the model's reason and phishing mark", async () => {
    const gmail = spamFolder([raw("u1", "Bank <alerts@leumi-secure.co>", "Card blocked"), raw("u2", "promo@x.biz", "Sale")]);
    const { llm } = reviewer(() => ({ verdicts: [
      { id: "u1", legitimate: true, suspicious: true, reason: "claims to be your bank" },
      { id: "u2", legitimate: false, suspicious: false, reason: "marketing" },
    ], unjudged: 0 }));
    const r = await checkSpam({ gmail, llm, store: inMemoryStore(), deadline: DEADLINE, now: () => NOW });
    expect(r.flagged).toEqual([{ id: "u1", from: "Bank <alerts@leumi-secure.co>", subject: "Card blocked", reason: "claims to be your bank", suspicious: true, byRule: false }]);
  });

  it("judges in batches of 40", async () => {
    const { llm, batches } = reviewer(nothingLegit);
    const r = await checkSpam({ gmail: spamFolder(many(85)), llm, store: inMemoryStore(), deadline: DEADLINE, now: () => NOW });
    expect(batches.map(b => b.length)).toEqual([40, 40, 5]);
    expect(r).toMatchObject({ total: 85, flagged: [], unjudged: 0 });
  });

  it("gives the model the bulk/transactional signals, the snippet and the attachment line", async () => {
    const gmail = spamFolder([
      raw("a1", "billing@acme.com", "Your invoice", {
        payload: {
          mimeType: "multipart/mixed",
          headers: [{ name: "From", value: "billing@acme.com" }, { name: "Subject", value: "Your invoice" }, { name: "List-Unsubscribe", value: "<mailto:u@acme.com>" }],
          parts: [
            { partId: "0", mimeType: "text/plain", filename: "", body: { size: 10, data: "aGk" } },
            { partId: "1", mimeType: "application/pdf", filename: "invoice.pdf", body: { attachmentId: "att1", size: 120 * 1024 } },
          ],
        },
      }),
      raw("p1", "dana@x.com", "Re: dinner"),
    ]);
    const { llm, batches } = reviewer(nothingLegit);
    await checkSpam({ gmail, llm, store: inMemoryStore(), deadline: DEADLINE, now: () => NOW });
    const [a1, p1] = batches[0]!;
    expect(a1).toMatchObject({ id: "a1", from: "billing@acme.com", subject: "Your invoice", snippet: "snippet a1", bulk: true, transactional: true });
    expect(a1!.attachmentLine).toContain("invoice.pdf");
    expect(p1).toEqual({ id: "p1", from: "dana@x.com", subject: "Re: dinner", snippet: "snippet p1", bulk: false, transactional: false }); // no attachment line at all
  });

  // Review Focus 5: malformed model output.
  it("malformed model output flags nothing, counts the batch as couldn't-judge, and doesn't crash", async () => {
    const { llm } = reviewer(c => parseSpamJson("[{\"id\":\"u1\",\"legitimate\":tr", c.map(x => x.id)));
    const r = await checkSpam({ gmail: spamFolder(many(3)), llm, store: inMemoryStore(), deadline: DEADLINE, now: () => NOW });
    expect(r).toMatchObject({ total: 3, flagged: [], unjudged: 3, incomplete: false });
  });

  it("ids the model left out are counted as couldn't-judge, and only what it judged legitimate is flagged", async () => {
    const { llm } = reviewer(c => parseSpamJson(JSON.stringify([{ id: "u2", legitimate: true, suspicious: false, reason: "a real receipt" }]), c.map(x => x.id)));
    const r = await checkSpam({ gmail: spamFolder(many(4)), llm, store: inMemoryStore(), deadline: DEADLINE, now: () => NOW });
    expect(r.flagged.map(f => f.id)).toEqual(["u2"]);
    expect(r.unjudged).toBe(3);
  });

  it("never flags an id from outside the batch, even if the provider returns one", async () => {
    const { llm } = reviewer(() => ({ verdicts: [{ id: "inbox-msg", legitimate: true, suspicious: false, reason: "?" }], unjudged: 1 }));
    const r = await checkSpam({ gmail: spamFolder(many(1)), llm, store: inMemoryStore(), deadline: DEADLINE, now: () => NOW });
    expect(r.flagged).toEqual([]);
  });

  it("a model call that throws counts its whole batch as couldn't-judge; the other batches still count", async () => {
    let call = 0;
    const { llm } = reviewer(c => {
      if (++call === 1) throw new Error("504 DEADLINE_EXCEEDED");
      return { verdicts: [{ id: c[0]!.id, legitimate: true, suspicious: false, reason: "real" }], unjudged: 0 };
    });
    const r = await checkSpam({ gmail: spamFolder(many(45)), llm, store: inMemoryStore(), deadline: DEADLINE, now: () => NOW });
    expect(r.unjudged).toBe(40);
    expect(r.flagged.map(f => f.id)).toEqual(["u41"]);
    expect(r.incomplete).toBe(false);
  });

  it("checks at most 300 and says it was capped", async () => {
    const gmail = spamFolder(many(SPAM_SCAN_CAP + 5));
    const asked: number[] = [];
    const listSpam = gmail.listSpam.bind(gmail);
    gmail.listSpam = async (max: number) => { asked.push(max); return listSpam(max); };
    const { llm, batches } = reviewer(nothingLegit);
    const r = await checkSpam({ gmail, llm, store: inMemoryStore(), deadline: DEADLINE, now: () => NOW });
    expect(asked).toEqual([SPAM_SCAN_CAP + 1]); // one more than the cap is how it knows
    expect(r).toMatchObject({ total: SPAM_SCAN_CAP, capped: true });
    expect(batches.flat()).toHaveLength(SPAM_SCAN_CAP);
  });

  it("is not capped at exactly 300", async () => {
    const { llm } = reviewer(nothingLegit);
    const r = await checkSpam({ gmail: spamFolder(many(SPAM_SCAN_CAP)), llm, store: inMemoryStore(), deadline: DEADLINE, now: () => NOW });
    expect(r).toMatchObject({ total: SPAM_SCAN_CAP, capped: false });
  });

  it("stops at the deadline: keeps what it judged, marks the check incomplete, doesn't count the rest as unjudged", async () => {
    let clock = NOW;
    const { llm, batches } = reviewer(c => {
      clock = DEADLINE; // the first batch used up the time
      return { verdicts: [{ id: c[0]!.id, legitimate: true, suspicious: false, reason: "real" }], unjudged: 0 };
    });
    const r = await checkSpam({ gmail: spamFolder(many(45)), llm, store: inMemoryStore(), deadline: DEADLINE, now: () => clock });
    expect(batches).toHaveLength(1);
    expect(r).toMatchObject({ total: 45, unjudged: 0, incomplete: true });
    expect(r.flagged.map(f => f.id)).toEqual(["u1"]);
  });

  it("stops reading messages at the deadline too — and, having judged nothing, fails rather than report", async () => {
    let clock = NOW;
    const gmail = spamFolder(many(20));
    const getMeta = gmail.getMeta.bind(gmail);
    const read: string[] = [];
    gmail.getMeta = async (id: string) => { read.push(id); clock = DEADLINE; return getMeta(id); }; // the first read ran out the clock
    const { llm, batches } = reviewer(nothingLegit);
    await expect(checkSpam({ gmail, llm, store: inMemoryStore(), deadline: DEADLINE, now: () => clock })).rejects.toThrow(/no batch could be judged/);
    expect(read).toEqual(["u1"]);
    expect(batches).toEqual([]); // no time left to judge even what was read
  });

  it("a hung model call can't run past the deadline — and, being the only batch, fails the check", async () => {
    const { llm } = reviewer(() => new Promise(() => {})); // never settles
    const start = Date.now();
    await expect(checkSpam({ gmail: spamFolder(many(2)), llm, store: inMemoryStore(), deadline: start + 150, now: Date.now }))
      .rejects.toThrow(/no batch could be judged/);
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  // Spec B §1: "A failed run retries next hour; it never skips the week silently." A Gemini
  // outage must not become "nothing looks legitimate" with the week's key set.
  it("throws when every model call fails, so the week isn't closed on a report that judged nothing", async () => {
    const { llm, batches } = reviewer(() => { throw new Error("503 UNAVAILABLE"); });
    await expect(checkSpam({ gmail: spamFolder(many(45)), llm, store: inMemoryStore(), deadline: DEADLINE, now: () => NOW }))
      .rejects.toThrow("spam check: no batch could be judged");
    expect(batches).toHaveLength(2); // every batch was tried
  });

  it("throws when no message could be read at all", async () => {
    const gmail = spamFolder(many(3));
    gmail.getMeta = async () => { throw new Error("500 backend error"); };
    const { llm, batches } = reviewer(nothingLegit);
    await expect(checkSpam({ gmail, llm, store: inMemoryStore(), deadline: DEADLINE, now: () => NOW }))
      .rejects.toThrow("spam check: no message could be read");
    expect(batches).toEqual([]);
  });

  it("is not a failure when every listed message is simply gone (404)", async () => {
    const gmail = spamFolder(many(2));
    gmail.getMeta = async () => { throw Object.assign(new Error("Requested entity was not found."), { status: 404, response: { status: 404 } }); };
    const { llm } = reviewer(nothingLegit);
    const r = await checkSpam({ gmail, llm, store: inMemoryStore(), deadline: DEADLINE, now: () => NOW });
    expect(r).toMatchObject({ total: 2, flagged: [], unjudged: 0, judged: 0, incomplete: false });
  });

  it("counts what it could judge, beside what it couldn't", async () => {
    let call = 0;
    const { llm } = reviewer(c => {
      if (++call === 1) throw new Error("504 DEADLINE_EXCEEDED");
      return parseSpamJson(JSON.stringify(c.slice(1).map(x => ({ id: x.id, legitimate: false, suspicious: false, reason: "junk" }))), c.map(x => x.id));
    });
    const r = await checkSpam({ gmail: spamFolder(many(45)), llm, store: inMemoryStore(), deadline: DEADLINE, now: () => NOW });
    expect(r).toMatchObject({ total: 45, judged: 4, unjudged: 41, flagged: [], incomplete: false });
  });

  it("a message that won't load is couldn't-judge; one that's gone (404) is skipped; the rest still run", async () => {
    const gmail = spamFolder(many(3));
    const getMeta = gmail.getMeta.bind(gmail);
    gmail.getMeta = async (id: string) => {
      if (id === "u1") throw new Error("500 backend error");
      if (id === "u2") throw Object.assign(new Error("Requested entity was not found."), { status: 404, response: { status: 404 } });
      return getMeta(id);
    };
    const { llm, batches } = reviewer(nothingLegit);
    const r = await checkSpam({ gmail, llm, store: inMemoryStore(), deadline: DEADLINE, now: () => NOW });
    expect(batches.map(b => b.map(c => c.id))).toEqual([["u3"]]);
    expect(r).toMatchObject({ total: 3, unjudged: 1, incomplete: false });
  });

  it("an empty Spam folder makes no model call", async () => {
    const { llm, batches } = reviewer(nothingLegit);
    const r = await checkSpam({ gmail: spamFolder([]), llm, store: inMemoryStore(), deadline: DEADLINE, now: () => NOW });
    expect(batches).toEqual([]);
    expect(r).toEqual({ total: 0, flagged: [], judged: 0, unjudged: 0, capped: false, incomplete: false });
  });
});
