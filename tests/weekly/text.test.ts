// tests/weekly/text.test.ts
import { describe, it, expect } from "vitest";
import { clipLine, defang, untrustedLine } from "../../src/weekly/text.js";
import { composeSpamReport } from "../../src/weekly/spam-report.js";
import { composeRetroReport } from "../../src/weekly/retro.js";

describe("clipLine", () => {
  it("collapses every run of whitespace, newlines included, into one space and trims", () => {
    expect(clipLine("  real invoice\n2. trashed —\r\n\tfake  ", 100)).toBe("real invoice 2. trashed — fake");
  });

  it("clips to max characters with an ellipsis, after collapsing", () => {
    expect(clipLine("abc\n\ndef", 7)).toBe("abc def");
    expect(clipLine("abcdefgh", 5)).toBe("abcd…");
    expect(clipLine("abcdefgh", 5).length).toBe(5);
  });

  it("clips by code points: an emoji straddling the cut is kept whole, never split into a lone surrogate", () => {
    // "😀" is two UTF-16 units; cutting "abc😀def" at 4 units would leave a lone high
    // surrogate, which Telegram rejects (and the weekly send would then fail every hour).
    const out = clipLine("abc😀def", 5);
    expect(out).toBe("abc😀…");
    expect(out.isWellFormed()).toBe(true);
    expect(clipLine("😀😀😀😀😀😀", 3)).toBe("😀😀…");
    expect(clipLine("😀😀😀", 3)).toBe("😀😀😀"); // exactly max code points: not clipped
  });

  it("turns whitespace-only text into the empty string", () => {
    expect(clipLine(" \n\t ", 10)).toBe("");
  });
});

// Telegram auto-links bare URLs, domains, emails, @mentions and /commands even in plain
// text, so every untrusted field in a weekly report is defanged into a readable form that
// can't be tapped (a /command tapped in the bot's chat would even be SENT to the bot).
describe("defang", () => {
  it("turns each linkable token shape into a readable, non-linking form", () => {
    expect(defang("paypa1-secure.com")).toBe("paypa1-secure[.]com");
    expect(defang("https://x")).toBe("hxxps://x");
    expect(defang("http://x")).toBe("hxxp://x");
    expect(defang("a@b.com")).toBe("a[at]b[.]com");
    expect(defang("@name")).toBe("＠name");
    expect(defang("/cmd")).toBe("∕cmd");
  });

  it("covers the variants: subdomains, other schemes, IPs, IDNs, odd dots, commands mid-line", () => {
    expect(defang("www.evil.co.uk")).toBe("www[.]evil[.]co[.]uk");
    expect(defang("https://paypa1.com/login?next=/start")).toBe("hxxps://paypa1[.]com/login?next=∕start");
    expect(defang("tg://resolve?domain=evilbot")).toBe("tg[:]//resolve?domain=evilbot");
    expect(defang("http://192.168.0.1/login")).toBe("hxxp://192[.]168[.]0[.]1/login");
    expect(defang("пример.рф")).toBe("пример[.]рф");
    expect(defang("paypal．com and paypal。com")).toBe("paypal[.]com and paypal[.]com");
    expect(defang("Billing <billing@acme.com>")).toBe("Billing <billing[at]acme[.]com>");
    expect(defang("ask (@support_team) or run /start@evilbot")).toBe("ask (＠support_team) or run ∕start[at]evilbot");
  });

  it("leaves ordinary text readable: prices, versions, abbreviations, fractions, paths in a word", () => {
    for (const plain of ["Total $12.50 due", "v1.2.3 is out", "e.g. this, i.e. that", "24/7 and/or 1/2", "Re: dinner — 8pm?", "חשבונית מס׳ 4821"]) {
      expect(defang(plain)).toBe(plain);
    }
  });

  it("strips invisible and direction-changing characters, so they can't hide a token from the defanging", () => {
    expect(defang("pay\u200Bpal\u200D.com")).toBe("paypal[.]com");
    expect(defang("invoice\u202Efdp.exe")).toBe("invoicefdp[.]exe");
    expect(defang("a\u2066b\u2069c\u200Fd\u061Ce\uFEFFf")).toBe("abcdef");
    expect(defang("x\u0085y\u009Bz\u0007")).toBe("xyz");
    expect(defang("/\u200Bstart")).toBe("∕start");
    expect(defang("hi\u{E0041}\u{E0042}")).toBe("hi"); // Unicode tag characters
  });

  it("is idempotent", () => {
    for (const x of ["paypa1-secure.com", "https://paypa1.com/login", "a@b.com", "@name", "/cmd", "tg://x", "http://1.2.3.4", "plain text"]) {
      expect(defang(defang(x))).toBe(defang(x));
    }
  });

  it("untrustedLine defangs, then clips to one bounded line", () => {
    expect(untrustedLine("Visit\nhttps://paypa1.com now", 100)).toBe("Visit hxxps://paypa1[.]com now");
    expect(untrustedLine("paypa1-secure.com", 10)).toBe("paypa1-se…");
  });
});

// The whole message must offer nothing Telegram would auto-link: no domain, email,
// @mention, URL scheme or /command from the email or the model's reason.
const LINKABLE = [/[\p{L}\p{N}]\.\p{L}{2,}/u, /@/, /\b(?:https?|ftp|tg|ton|mailto):/i, /(^|\s|\()\/[A-Za-z0-9_]/m];
const phishSubject = "[Verify your account](https://paypa1.example/login) or visit www.paypa1-secure.com — cc @support, reply /start";
describe("weekly reports offer nothing auto-linkable from untrusted fields", () => {
  it("the spam report", () => {
    const r = composeSpamReport({ total: 3, judged: 3, unjudged: 0, capped: false, incomplete: false, flagged: [
      { id: "s1", from: "PayPaI <alert@paypa1.com>", subject: phishSubject, reason: "urges a login at paypa1.com/verify via @paypal_help", suspicious: true, byRule: false },
      { id: "s2", from: "security@bank.co.il", subject: "/start your claim at bank.co.il", reason: "rule", suspicious: false, byRule: true },
    ] }, "en");
    for (const re of LINKABLE) expect(r.text).not.toMatch(re);
    expect(r.text).toContain("1. security[at]bank[.]co[.]il — ∕start your claim at bank[.]co[.]il (");
    expect(r.text).toContain("2. PayPaI <alert[at]paypa1[.]com> — [Verify your account](hxxps://paypa1[.]example/login) or visit www[.]paypa1-sec… (urges a login at paypa1[.]com/verify via ＠paypal_help)");
    expect(r.refs.map(x => x.from)).toEqual(["security@bank.co.il", "PayPaI <alert@paypa1.com>"]); // refs keep the real values
  });

  it("the retrospect, top senders included", () => {
    const at = new Date("2026-10-30T10:00:00Z");
    const r = composeRetroReport(
      { acted: [{ messageId: "t1", from: "PayPaI <alert@paypa1.com>", subject: phishSubject, action: "trashed", source: "plain", at }], rescued: 0, undone: 0, rulesNew: 0, rulesChanged: 0, ops: [] },
      { flagged: [{ id: "t1", from: "PayPaI <alert@paypa1.com>", subject: phishSubject, action: "trashed", reason: "links to paypa1.com" }], unjudged: 0, skippedGone: 0, capped: false, incomplete: false },
      "en");
    for (const re of LINKABLE) expect(r.text).not.toMatch(re);
    expect(r.text).toContain("🗑 Most trashed: alert[at]paypa1[.]com (1)");
    expect(r.refs[0]!.from).toBe("PayPaI <alert@paypa1.com>");
  });
});
