import type { Bot } from "grammy";
import telegramifyMarkdown from "telegramify-markdown";

// The LLM emits Markdown. Render it in Telegram by converting to (safely-escaped)
// MarkdownV2. If conversion or the formatted send fails for any reason, fall back to
// plain text so a message always lands.
// Returns the sent Telegram message id (used to couple a digest to the emails it
// covered). Throws if both the formatted and plain sends fail.
export async function sendFormatted(bot: Bot, chatId: number, text: string, opts?: { silent?: boolean }): Promise<number | undefined> {
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
