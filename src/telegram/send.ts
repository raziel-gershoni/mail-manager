import type { Bot } from "grammy";
import telegramifyMarkdown from "telegramify-markdown";

// The LLM emits Markdown. Render it in Telegram by converting to (safely-escaped)
// MarkdownV2. If conversion or the formatted send fails for any reason, fall back to
// plain text so a message always lands.
export async function sendFormatted(bot: Bot, chatId: number, text: string): Promise<void> {
  try {
    const md = telegramifyMarkdown(text, "escape");
    await bot.api.sendMessage(chatId, md, { parse_mode: "MarkdownV2" });
  } catch {
    await bot.api.sendMessage(chatId, text);
  }
}
