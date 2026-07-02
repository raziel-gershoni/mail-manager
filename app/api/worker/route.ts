// app/api/worker/route.ts
import { env } from "../../../src/config/env.js";
import { verifyQStash } from "../../../src/queue/qstash.js";
import { authedGmailFor } from "../../../src/oauth/google.js";
import { googleGmailClient } from "../../../src/gmail/client.js";
import { geminiProvider } from "../../../src/llm/gemini.js";
import { dbMemoryStore } from "../../../src/db/adapters.js";
import { dbConversationRepo } from "../../../src/db/conversation-adapter.js";
import { readOnlyTools } from "../../../src/agent/tools.js";
import { trashTools } from "../../../src/cleanup/tools.js";
import { dbProposalRepo, dbActionLogRepo } from "../../../src/db/cleanup-adapters.js";
import { handleMessage, isAllowed } from "../../../src/telegram/bot.js";
import { sendFormatted } from "../../../src/telegram/send.js";
import { Bot } from "grammy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const USER_ID = 1;

export async function POST(req: Request): Promise<Response> {
  const e = env();
  const update = await verifyQStash(e, req) as any;
  const fromId = (update as any)?.message?.from?.id;
  if (!isAllowed(e.TELEGRAM_OWNER_ID, fromId)) return Response.json({ ok: true, skipped: true });
  const text = update?.message?.text;
  const chatId = update?.message?.chat?.id;
  if (typeof text !== "string" || !chatId) return Response.json({ ok: true, skipped: true });
  const auth = await authedGmailFor(USER_ID, e);
  const store = await dbMemoryStore(USER_ID);
  const reply = await handleMessage(text, {
    userId: USER_ID, gmail: googleGmailClient(auth), memory: store,
    llm: geminiProvider(e.GEMINI_API_KEY), convo: dbConversationRepo(),
    proposals: dbProposalRepo(), actionLog: dbActionLogRepo(),
    tools: [...readOnlyTools(), ...trashTools()], timezone: e.OWNER_TZ,
  });
  await store.flush();
  const bot = new Bot(e.TELEGRAM_BOT_TOKEN);
  await sendFormatted(bot, chatId, reply);
  return Response.json({ ok: true });
}
