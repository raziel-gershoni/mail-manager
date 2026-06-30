// src/telegram/bot.ts
import { Bot, InlineKeyboard } from "grammy";
import type { Env } from "../config/env.js";
import type { MemoryStore } from "../memory/store.js";
import type { SeenRepo } from "../notifier/sync.js";
import { buildReviewDigest } from "../notifier/digest.js";

export function isAllowed(ownerId: number, fromId: number | undefined): boolean {
  return fromId !== undefined && fromId === ownerId;
}

export interface HandlerDeps {
  store: MemoryStore; seen: SeenRepo; userId: number;
  gmailFromEmail(messageId: string): Promise<string>;
}

export async function handleCallback(data: string, deps: HandlerDeps): Promise<{ reply: string }> {
  const [action, id] = data.split(":");
  if ((action === "ni" || action === "ai") && id) {
    const email = await deps.gmailFromEmail(id);
    if (action === "ni") { deps.store.upsertSenderRule(email, "unimportant"); return { reply: `Got it — muting ${email}.` }; }
    deps.store.upsertSenderRule(email, "important"); return { reply: `Noted — ${email} is important.` };
  }
  return { reply: "Unknown action." };
}

export function buildBot(env: Env, deps: HandlerDeps): Bot {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  bot.use(async (ctx, next) => { if (isAllowed(env.TELEGRAM_OWNER_ID, ctx.from?.id)) await next(); });

  bot.on("callback_query:data", async (ctx) => {
    const { reply } = await handleCallback(ctx.callbackQuery.data, deps);
    await ctx.answerCallbackQuery({ text: reply });
  });

  bot.command("rules", async (ctx) => {
    const rules = deps.store.list();
    const text = rules.length ? rules.map(r => `• ${r.description}`).join("\n") : "No rules learned yet.";
    await ctx.reply(text);
  });

  bot.command("review", async (ctx) => {
    const sus = await deps.seen.recentSuspicious(deps.userId, 10);
    const items = await Promise.all(sus.map(async s => ({
      messageId: s.messageId, from: await deps.gmailFromEmail(s.messageId), subject: "(set aside)", reason: s.reason,
    })));
    const msg = buildReviewDigest(items);
    if (!msg) { await ctx.reply("Nothing set aside recently."); return; }
    const kb = new InlineKeyboard();
    for (const row of msg.buttons) { for (const b of row) kb.text(b.text, b.callbackData); kb.row(); }
    await ctx.reply(msg.text, { reply_markup: kb, parse_mode: "Markdown" });
  });

  return bot;
}
