// tests/telegram/send.test.ts
// The weekly reports quote untrusted sender/subject/reason text verbatim, so they go out
// as plain text: nothing in them may render as a link, a mailto link or formatting.
import { describe, it, expect } from "vitest";
import type { Bot } from "grammy";
import { sendFormatted, sendPlain } from "../../src/telegram/send.js";
import { composeSpamReport } from "../../src/weekly/spam-report.js";
import type { FlaggedSpam, SpamCheck } from "../../src/weekly/spam.js";

function fakeBot() {
  const calls: { chatId: number; text: string; other?: Record<string, unknown> }[] = [];
  const api = {
    sendMessage: async (chatId: number, text: string, other?: Record<string, unknown>) => {
      calls.push({ chatId, text, other }); return { message_id: 700 + calls.length };
    },
  };
  return { bot: { api } as unknown as Bot, calls };
}

const phish: FlaggedSpam = {
  id: "s9", from: "PayPaI <alert@paypa1.com>", subject: "[Verify your account](https://paypa1.example/login)",
  reason: "*urgent* notice", suspicious: true, byRule: false,
};
const check: SpamCheck = { total: 12, flagged: [phish], judged: 12, unjudged: 0, capped: false, incomplete: false };

describe("sendFormatted", () => {
  it("never sends a lone surrogate, formatted or on the plain fallback", async () => {
    const { bot, calls } = fakeBot();
    await sendFormatted(bot, 555, "cut emoji \uD83D here");
    expect(calls[0]!.other?.parse_mode).toBe("MarkdownV2");
    expect(calls[0]!.text.isWellFormed()).toBe(true);
    expect(calls[0]!.text).toContain("\uFFFD");

    const failing = { api: { sendMessage: async (chatId: number, text: string, other?: Record<string, unknown>) => {
      calls.push({ chatId, text, other });
      if (other?.parse_mode) throw new Error("400: can't parse entities");
      return { message_id: 1 };
    } } } as unknown as Bot;
    calls.length = 0;
    await sendFormatted(failing, 555, "cut emoji \uD83D here");
    expect(calls[1]!.other?.parse_mode).toBeUndefined();
    expect(calls[1]!.text).toBe("cut emoji \uFFFD here");
  });
});

describe("sendPlain", () => {
  it("sends the text exactly as given, with no parse mode or entities, no link preview, and returns the message id", async () => {
    const { bot, calls } = fakeBot();
    const id = await sendPlain(bot, 555, "a *b* [c](https://x.example)", { silent: false });
    expect(id).toBe(701);
    expect(calls).toEqual([{ chatId: 555, text: "a *b* [c](https://x.example)", other: { link_preview_options: { is_disabled: true } } }]);
  });

  it("never sends a lone surrogate: it is replaced with U+FFFD so Telegram accepts the text", async () => {
    const { bot, calls } = fakeBot();
    await sendPlain(bot, 555, "cut emoji \uD83D here", { silent: false });
    expect(calls[0]!.text).toBe("cut emoji \uFFFD here");
    expect(calls[0]!.text.isWellFormed()).toBe(true);
  });

  it("goes out without a sound when silent", async () => {
    const { bot, calls } = fakeBot();
    await sendPlain(bot, 555, "quiet", { silent: true });
    expect(calls[0]!.other).toEqual({ link_preview_options: { is_disabled: true }, disable_notification: true });
  });

  it("does not render a markdown link in a flagged subject as a link", async () => {
    const report = composeSpamReport(check, "en");
    const { bot, calls } = fakeBot();
    await sendPlain(bot, 555, report.text, { silent: report.silent });
    const sent = calls[0]!;
    // The subject, the sender's address and the model's reason all arrive as literal text,
    // right above the phishing warning — no hidden URL behind anchor text, no mailto, no
    // italics — and defanged, so Telegram can't auto-link the bare address or URL either.
    expect(sent.text).toBe(report.text);
    expect(sent.text).toContain("1. PayPaI <alert[at]paypa1[.]com> — [Verify your account](hxxps://paypa1[.]example/login) (*urgent* notice)");
    expect(sent.text).toContain("⚠️ looks like phishing");
    expect(sent.other?.parse_mode).toBeUndefined();
    expect(sent.other?.entities).toBeUndefined();
    expect(sent.other?.link_preview_options).toEqual({ is_disabled: true });
  });

  it("is needed: sendFormatted would turn that subject into a hidden MarkdownV2 link", async () => {
    const { bot, calls } = fakeBot();
    await sendFormatted(bot, 555, `1. ${phish.from} — ${phish.subject} (${phish.reason})`);
    expect(calls[0]!.other?.parse_mode).toBe("MarkdownV2");
    expect(calls[0]!.text).toContain("[Verify your account](https://paypa1.example/login)");
    expect(calls[0]!.text).toContain("(mailto:alert@paypa1.com)");
  });
});
