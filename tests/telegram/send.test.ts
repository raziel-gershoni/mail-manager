// tests/telegram/send.test.ts
// The weekly reports quote untrusted sender/subject/reason text verbatim, so they go out
// as plain text: nothing in them may render as a link, a mailto link or formatting.
import { describe, it, expect } from "vitest";
import type { Bot } from "grammy";
import { messageParts, sendFormatted, sendPlain, splitMessage, TELEGRAM_PART_CHARS } from "../../src/telegram/send.js";
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

// Telegram rejects a message over 4096 characters ("400: Bad Request: message is too
// long"). A catch-up brief after a long break, or a long chat answer, can be longer than
// that, so long text goes out as several messages instead of failing outright.
describe("long messages", () => {
  // Rejects like Telegram does. The test texts contain no MarkdownV2 special characters,
  // so the length of what is sent equals the length Telegram would count.
  function telegramLikeBot() {
    const calls: { text: string; other?: Record<string, unknown> }[] = [];
    const api = {
      sendMessage: async (_chatId: number, text: string, other?: Record<string, unknown>) => {
        if (text.length > 4096) throw new Error("400: Bad Request: message is too long");
        calls.push({ text, other }); return { message_id: 900 + calls.length };
      },
    };
    return { bot: { api } as unknown as Bot, calls };
  }
  const para = (n: number, word: string) => Array.from({ length: n }, () => word).join(" ");

  it("sends a long brief as several messages, each within the limit, keeping every word", async () => {
    const text = Array.from({ length: 16 }, (_, i) => `Email ${i} ${para(120, "word")}`).join("\n\n");
    expect(text.length).toBeGreaterThan(4096 * 2);
    const { bot, calls } = telegramLikeBot();
    const ids = await sendFormatted(bot, 555, text);
    expect(calls.length).toBeGreaterThan(2);
    expect(ids).toEqual(calls.map((_, i) => 901 + i));
    for (const c of calls) expect(c.text.length).toBeLessThanOrEqual(TELEGRAM_PART_CHARS + 1);
    // Cut between paragraphs: every email starts a line, none is split mid-paragraph.
    const sent = calls.map(c => c.text.trimEnd());
    expect(sent.join("\n\n")).toBe(text);
  });

  it("buzzes once: only the first part can notify", async () => {
    const text = `${para(600, "word")}\n\n${para(600, "word")}`;
    const { bot, calls } = telegramLikeBot();
    await sendFormatted(bot, 555, text, { silent: false });
    expect(calls.length).toBe(2);
    expect(calls[0]!.other?.disable_notification).toBeUndefined();
    expect(calls[1]!.other?.disable_notification).toBe(true);

    calls.length = 0;
    await sendFormatted(bot, 555, text, { silent: true });
    expect(calls.every(c => c.other?.disable_notification === true)).toBe(true);
  });

  it("throws when a part can't be delivered either way, so the caller retries", async () => {
    let n = 0;
    const bot = { api: { sendMessage: async () => {
      n++;
      if (n > 1) throw new Error("telegram down");
      return { message_id: 1 };
    } } } as unknown as Bot;
    await expect(sendFormatted(bot, 555, `${para(600, "word")}\n\n${para(600, "word")}`)).rejects.toThrow("telegram down");
  });
});

describe("rate limits", () => {
  it("doesn't retry a rate-limited part as plain text: that hits the same limit", async () => {
    const modes: unknown[] = [];
    const bot = { api: { sendMessage: async (_c: number, _t: string, other?: Record<string, unknown>) => {
      modes.push(other?.parse_mode);
      throw Object.assign(new Error("429: Too Many Requests: retry after 40"), { error_code: 429 });
    } } } as unknown as Bot;
    await expect(sendFormatted(bot, 555, "hello")).rejects.toThrow("429");
    expect(modes).toEqual(["MarkdownV2"]);
  });
});

describe("splitMessage", () => {
  it("leaves text within the limit as one part", () => {
    expect(splitMessage("short\n\ntext", 100)).toEqual(["short\n\ntext"]);
  });

  it("cuts at the last paragraph break, else a line break, else a space", () => {
    expect(splitMessage("aaaa bbbb\n\ncccc\ndddd", 15)).toEqual(["aaaa bbbb", "cccc\ndddd"]);
    expect(splitMessage("aaaa bbbb\ncccc dddd", 15)).toEqual(["aaaa bbbb", "cccc dddd"]);
    expect(splitMessage("aaaa bbbb cccc dddd", 15)).toEqual(["aaaa bbbb cccc", "dddd"]);
  });

  it("keeps the indentation of the line that starts a new part", () => {
    expect(splitMessage("aaaa bbbb cccc\n  • nested", 15)).toEqual(["aaaa bbbb cccc", "  • nested"]);
  });

  it("hard-cuts a run with no break, never through an emoji", () => {
    const text = "😀".repeat(30); // 60 UTF-16 code units, no spaces
    const parts = splitMessage(text, 15);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(15);
      expect(p.isWellFormed()).toBe(true);
    }
    expect(parts.join("")).toBe(text);
  });

  it("keeps empty text as one part, so sending it still fails loudly", () => {
    expect(splitMessage("", 12)).toEqual([""]);
  });

  it("never returns an empty part", () => {
    const parts = splitMessage(`${"a".repeat(10)}\n\n\n\n\n\n${"b".repeat(10)}`, 12);
    expect(parts).toEqual(["a".repeat(10), "b".repeat(10)]);
  });

  it("splits Hebrew text the same way", () => {
    const parts = splitMessage("שלום עולם\n\nמה נשמע", 12);
    expect(parts).toEqual(["שלום עולם", "מה נשמע"]);
  });
});

// The MarkdownV2 render can show MORE characters than the Markdown it came from ("- a"
// shows as "•   a"), so a part is measured as rendered, and cut smaller when needed.
describe("rendered length", () => {
  // What Telegram counts for a MarkdownV2 message, from above: each escape once, markup
  // characters still counted.
  const shown = (text: string, mode?: unknown) => mode === "MarkdownV2" ? text.replace(/\\([\s\S])/g, "$1").length : text.length;
  function renderingBot() {
    const calls: { text: string; mode?: unknown }[] = [];
    const api = { sendMessage: async (_c: number, text: string, other?: Record<string, unknown>) => {
      if (shown(text, other?.parse_mode) > 4096) throw new Error("400: Bad Request: message is too long");
      calls.push({ text, mode: other?.parse_mode }); return { message_id: calls.length };
    } };
    return { bot: { api } as unknown as Bot, calls };
  }

  it("keeps a long short-item list formatted: no part is too long once rendered", async () => {
    const list = Array.from({ length: 900 }, () => "- a").join("\n");
    const { bot, calls } = renderingBot();
    await sendFormatted(bot, 555, list);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every(c => c.mode === "MarkdownV2")).toBe(true); // never fell back to plain
  });

  it("leaves ordinary text at the normal part size", () => {
    const text = Array.from({ length: 16 }, (_, i) => `Email ${i} ` + Array.from({ length: 120 }, () => "word").join(" ")).join("\n\n");
    expect(messageParts(text)).toEqual(splitMessage(text));
  });
});

describe("code blocks across a cut", () => {
  const code = Array.from({ length: 12 }, (_, i) => `const x${i} = ${i};`).join("\n");
  const text = `Intro\n\n\`\`\`js\n${code}\n\`\`\`\n\nafter`;
  const fences = (p: string) => p.split("\n").filter(l => l.startsWith("```")).length;

  it("closes the block at the cut and reopens it, language kept, in the next part", () => {
    const parts = splitMessage(text, 120);
    expect(parts).toHaveLength(2);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(120);
      expect(fences(p) % 2).toBe(0);
    }
    expect(parts[0]!.endsWith("\n```")).toBe(true);    // the cut fell inside the block
    expect(parts[1]!.startsWith("```js\n")).toBe(true);
    expect(parts[1]!.endsWith("after")).toBe(true);
    // Nothing of the code is lost or doubled.
    const lines = parts.join("\n").split("\n").filter(l => l.startsWith("const "));
    expect(lines).toEqual(code.split("\n"));
  });
});
