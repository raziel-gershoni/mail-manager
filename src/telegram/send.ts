import type { Bot } from "grammy";
import telegramifyMarkdown from "telegramify-markdown";

// The LLM emits Markdown. Render it in Telegram by converting to (safely-escaped)
// MarkdownV2. If conversion or the formatted send fails for any reason, fall back to
// plain text so a message always lands.
// Returns the sent Telegram message id (used to couple a digest to the emails it
// covered). Throws if both the formatted and plain sends fail.
// Both senders send text.toWellFormed(): a lone UTF-16 surrogate (half an emoji, from a
// cut somewhere upstream) makes Telegram reject the whole message, so it becomes U+FFFD.
export async function sendFormatted(bot: Bot, chatId: number, raw: string, opts?: { silent?: boolean }): Promise<number | undefined> {
  const text = raw.toWellFormed();
  const extra = opts?.silent ? { disable_notification: true } : {};
  try {
    const md = telegramifyMarkdown(text, "escape");
    const m = await bot.api.sendMessage(chatId, md, { parse_mode: "MarkdownV2", ...extra });
    return m.message_id;
  } catch {
    const m = await bot.api.sendMessage(chatId, text, extra);
    return m.message_id;
  }
}

// For a message the bot composes itself around UNTRUSTED email text (the weekly reports:
// senders, subjects, model reasons) and that has no markdown of its own. It goes out as
// plain text, with no parse_mode or entities. What that PREVENTS: markup the text carries
// — a hidden link behind anchor text ("[Verify](https://phish)" shows literally), a
// markdown mailto link, bold/italic. What it does NOT prevent: Telegram's own detection,
// which still makes a bare URL or domain, an email address, an @mention, a /command (a
// tapped one is sent to the bot), a #hashtag or a phone number tappable in plain text.
// So the callers defang every untrusted field first (src/weekly/text.ts, defang).
// Link previews are off as well, so a URL that slips through isn't fetched and shown as a
// card. Like sendFormatted it doesn't split, so the caller keeps the text under 4096 characters.
export async function sendPlain(bot: Bot, chatId: number, text: string, opts?: { silent?: boolean }): Promise<number> {
  const m = await bot.api.sendMessage(chatId, text.toWellFormed(), {
    link_preview_options: { is_disabled: true },
    ...(opts?.silent ? { disable_notification: true } : {}),
  });
  return m.message_id;
}
