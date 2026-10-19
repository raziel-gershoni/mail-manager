// tests/weekly/spam-report.test.ts
import { describe, it, expect } from "vitest";
import { composeSpamReport, MAX_REPORT_CHARS } from "../../src/weekly/spam-report.js";
import type { FlaggedSpam, SpamCheck } from "../../src/weekly/spam.js";

const acme: FlaggedSpam = { id: "s1", from: "Acme Billing <billing@acme.com>", subject: "Invoice 12", reason: "rule:sender:billing@acme.com", suspicious: false, byRule: true };
const paypal: FlaggedSpam = { id: "s2", from: "PayPaI <alert@paypa1.com>", subject: "Account locked", reason: "claims to be PayPal", suspicious: true, byRule: false };
const dana: FlaggedSpam = { id: "s3", from: "Dana <dana@x.com>", subject: "Re: dinner", reason: "a personal reply", suspicious: false, byRule: false };
const check = (over: Partial<SpamCheck> = {}): SpamCheck => ({ total: 143, flagged: [], judged: 143, unjudged: 0, capped: false, incomplete: false, ...over });
const flagged = (n: number, over: Partial<FlaggedSpam> = {}): FlaggedSpam[] =>
  Array.from({ length: n }, (_, i) => ({ id: `f${i + 1}`, from: `sender${i + 1}@x.com`, subject: `Subject ${i + 1}`, reason: "looks real", suspicious: false, byRule: false, ...over }));

describe("composeSpamReport", () => {
  it("lists what looks legitimate, numbered, possible phishing last and marked, and buzzes", () => {
    const r = composeSpamReport(check({ flagged: [acme, paypal, dana] }), "en");
    expect(r.text).toBe([
      "🧹 Spam check (last 7 days): 143 in spam, 3 look legitimate:",
      "1. Acme Billing <billing[at]acme[.]com> — Invoice 12 (you have a rule for this sender, but Gmail put it in Spam — check it's really them)",
      "2. Dana <dana[at]x[.]com> — Re: dinner (a personal reply)",
      "3. PayPaI <alert[at]paypa1[.]com> — Account locked (claims to be PayPal)",
      "   ⚠️ looks like phishing — rescue only if you're sure",
      'Reply "rescue 1 3" or "rescue all".',
    ].join("\n"));
    expect(r.silent).toBe(false);
  });

  it("couples the message to the exact ids in the report's numbered order, marking the phishing one", () => {
    const r = composeSpamReport(check({ flagged: [acme, paypal, dana] }), "en");
    expect(r.refs).toEqual([
      { id: "s1", from: "Acme Billing <billing@acme.com>", subject: "Invoice 12", kind: "spam" },
      { id: "s3", from: "Dana <dana@x.com>", subject: "Re: dinner", kind: "spam" },
      { id: "s2", from: "PayPaI <alert@paypa1.com>", subject: "Account locked", kind: "spam-phishing" },
    ]);
  });

  it("a rule-matched sender the model marked suspicious is listed last, warned, and needs explicit confirmation", () => {
    const forged: FlaggedSpam = { ...acme, suspicious: true };
    const r = composeSpamReport(check({ flagged: [forged, dana] }), "en");
    expect(r.text).toBe([
      "🧹 Spam check (last 7 days): 143 in spam, 2 look legitimate:",
      "1. Dana <dana[at]x[.]com> — Re: dinner (a personal reply)",
      "2. Acme Billing <billing[at]acme[.]com> — Invoice 12 (you have a rule for this sender, but Gmail put it in Spam — check it's really them)",
      "   ⚠️ looks like phishing — rescue only if you're sure",
      'Reply "rescue 1 3" or "rescue all".',
    ].join("\n"));
    expect(r.refs.map(x => [x.id, x.kind])).toEqual([["s3", "spam"], ["s1", "spam-phishing"]]);
  });

  it("says 'looks' for exactly one", () => {
    expect(composeSpamReport(check({ flagged: [dana] }), "en").text.split("\n")[0]).toBe("🧹 Spam check (last 7 days): 143 in spam, 1 looks legitimate:");
  });

  it("is a silent one-liner, with no refs, when nothing looks legitimate", () => {
    expect(composeSpamReport(check(), "en")).toEqual({ text: "🧹 Spam check: 143 in spam, nothing looks legitimate.", silent: true, refs: [] });
  });

  it("says so when Spam is empty", () => {
    expect(composeSpamReport(check({ total: 0 }), "en")).toEqual({ text: "🧹 Spam check: nothing in spam from the last 7 days.", silent: true, refs: [] });
  });

  it("writes Hebrew", () => {
    const r = composeSpamReport(check({ flagged: [acme, paypal, dana] }), "he");
    expect(r.text).toBe([
      "🧹 בדיקת ספאם (7 הימים האחרונים): 143 בספאם, 3 נראים לגיטימיים:",
      "1. Acme Billing <billing[at]acme[.]com> — Invoice 12 (יש לך כלל לשולח הזה, אבל Gmail שם אותו בספאם — כדאי לוודא שזה באמת השולח)",
      "2. Dana <dana[at]x[.]com> — Re: dinner (a personal reply)",
      "3. PayPaI <alert[at]paypa1[.]com> — Account locked (claims to be PayPal)",
      "   ⚠️ נראה כמו פישינג — לחלץ רק אם את/ה בטוח/ה",
      'השב/י "חלץ 1 3" או "חלץ הכול".',
    ].join("\n"));
    expect(composeSpamReport(check(), "he").text).toBe("🧹 בדיקת ספאם: 143 בספאם, שום דבר לא נראה לגיטימי.");
  });

  it("notes the cap, a check that ran out of time, and what it couldn't judge — before the reply hint", () => {
    const r = composeSpamReport(check({ total: 300, capped: true, incomplete: true, unjudged: 4, flagged: [dana] }), "en");
    expect(r.text).toBe([
      "🧹 Spam check (last 7 days): 300+ in spam, 1 looks legitimate:",
      "1. Dana <dana[at]x[.]com> — Re: dinner (a personal reply)",
      "There were more than 300 — I checked the newest 300.",
      "⏱ I ran out of time before checking them all — look through Gmail's Spam folder for the rest.",
      "I couldn't judge 4 of them.",
      'Reply "rescue 1 3" or "rescue all".',
    ].join("\n"));
  });

  it("keeps the notes on the silent one-liner too", () => {
    const r = composeSpamReport(check({ total: 300, capped: true, incomplete: true, judged: 120 }), "en");
    expect(r.text).toBe([
      "🧹 Spam check: 300+ in spam, nothing looks legitimate.",
      "There were more than 300 — I checked the newest 300.",
      "⏱ I ran out of time before checking them all — look through Gmail's Spam folder for the rest.",
    ].join("\n"));
    expect(r.silent).toBe(true);
  });

  it("never says 'nothing looks legitimate' when some couldn't be judged: says how many it could, and buzzes", () => {
    const r = composeSpamReport(check({ judged: 100, unjudged: 43 }), "en");
    expect(r).toEqual({
      text: "🧹 Spam check: 143 in spam — none of the 100 I could judge looks legitimate; I couldn't judge 43.",
      silent: false, refs: [],
    });
    const withNotes = composeSpamReport(check({ incomplete: true, judged: 40, unjudged: 2 }), "en");
    expect(withNotes.text).toBe([
      "🧹 Spam check: 143 in spam — none of the 40 I could judge looks legitimate; I couldn't judge 2.",
      "⏱ I ran out of time before checking them all — look through Gmail's Spam folder for the rest.",
    ].join("\n"));
    expect(withNotes.silent).toBe(false);
    expect(composeSpamReport(check({ judged: 100, unjudged: 43 }), "he").text)
      .toBe("🧹 בדיקת ספאם: 143 בספאם — אף אחד מ־100 שהצלחתי לשפוט לא נראה לגיטימי; לא הצלחתי לשפוט 43.");
  });

  // "rescue all" means every ref, so the refs are exactly what the owner was shown: the
  // listed items, in report order. The rest are behind "+N more — ask me".
  it("lists at most 20, says how many more, and keeps refs only for the listed ones, in order", () => {
    const r = composeSpamReport(check({ flagged: flagged(25) }), "en");
    const lines = r.text.split("\n");
    expect(lines.filter(l => /^\d+\. /.test(l))).toHaveLength(20);
    expect(lines).toContain("20. sender20[at]x[.]com — Subject 20 (looks real)");
    expect(lines).toContain("+5 more — ask me");
    expect(r.refs.map(x => x.id)).toEqual(flagged(25).slice(0, 20).map(f => f.id));
  });

  it("stays inside Telegram's limit however long the senders, subjects and reasons are — refs only for what fit", () => {
    const huge = "x".repeat(500);
    const r = composeSpamReport(check({ flagged: flagged(20, { from: huge, subject: huge, reason: huge, suspicious: true }) }), "he");
    expect(r.text.length).toBeLessThanOrEqual(MAX_REPORT_CHARS);
    expect(r.text).toContain("…");
    const numbered = r.text.split("\n").filter(l => /^\d+\. /.test(l));
    expect(numbered.length).toBeGreaterThan(0);
    expect(numbered.length).toBeLessThan(20);
    expect(r.refs.map(x => x.id)).toEqual(flagged(20).slice(0, numbered.length).map(f => f.id));
    expect(r.text).toContain(`ועוד ${20 - numbered.length} — אפשר לשאול אותי`);
  });

  it("shows (no subject) for an empty subject", () => {
    expect(composeSpamReport(check({ flagged: [{ ...dana, subject: "" }] }), "en").text).toContain("1. Dana <dana[at]x[.]com> — (no subject) (a personal reply)");
  });
});
