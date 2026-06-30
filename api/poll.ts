// api/poll.ts
import { env } from "../src/config/env.js";
import { verifyQStash } from "../src/queue/qstash.js";
import { authedGmailFor } from "../src/oauth/google.js";
import { googleGmailClient } from "../src/gmail/client.js";
import { geminiProvider } from "../src/llm/gemini.js";
import { dbMemoryStore, dbSeenRepo, dbSyncRepo } from "../src/db/adapters.js";
import { runPoll } from "../src/notifier/poll.js";
import { buildImportantDigest } from "../src/notifier/digest.js";
import { Bot, InlineKeyboard } from "grammy";

const USER_ID = 1; // single-user bootstrap

export default async function handler(req: Request): Promise<Response> {
  const e = env();
  await verifyQStash(e, req);
  const auth = await authedGmailFor(USER_ID, e);
  const result = await runPoll({
    userId: USER_ID, gmail: googleGmailClient(auth),
    store: await dbMemoryStore(USER_ID), llm: geminiProvider(e.GEMINI_API_KEY),
    sync: dbSyncRepo(), seen: dbSeenRepo(),
  });
  const msg = buildImportantDigest(result.important);
  if (msg) {
    const bot = new Bot(e.TELEGRAM_BOT_TOKEN);
    const kb = new InlineKeyboard();
    for (const r of msg.buttons) { for (const b of r) kb.text(b.text, b.callbackData); kb.row(); }
    await bot.api.sendMessage(e.TELEGRAM_OWNER_ID, msg.text, { reply_markup: kb, parse_mode: "Markdown" });
  }
  return Response.json({ ok: true, ...result, important: result.important.length });
}
