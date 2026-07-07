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
import { handleMessage } from "../../../src/telegram/bot.js";
import { sendFormatted } from "../../../src/telegram/send.js";
import { resolveUserForTelegram } from "../../../src/users/identity.js";
import { dbTelegramLinkRepo, dbUserDirectory } from "../../../src/db/user-adapters.js";
import { dbSettingsRepo } from "../../../src/db/settings-adapter.js";
import { effectiveSettings } from "../../../src/settings/settings.js";
import { withIdempotency } from "../../../src/queue/idempotency.js";
import { dbIdempotencyRepo } from "../../../src/db/idempotency-adapter.js";
import { log, logPreview } from "../../../src/util/log.js";
import { Bot } from "grammy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const t0 = Date.now();
  const e = env();
  const update = await verifyQStash(e, req) as any;
  const fromId = update?.message?.from?.id;
  const chatId = update?.message?.chat?.id;
  const text = update?.message?.text;
  const updateId = update?.update_id;
  if (typeof fromId !== "number" || typeof text !== "string" || typeof chatId !== "number") {
    log("worker.skip", { reason: "bad_payload", updateId });
    return Response.json({ ok: true, skipped: true });
  }
  log("worker.recv", { updateId, fromId, chatId, textLen: text.length, text: logPreview(text, 1000) });
  const userId = await resolveUserForTelegram(e.TELEGRAM_OWNER_ID, fromId, chatId, dbTelegramLinkRepo(), dbUserDirectory());
  if (userId === null) {
    log("worker.skip", { reason: "unauthorized", updateId, fromId });
    return Response.json({ ok: true, skipped: true });
  }
  const key = String(updateId ?? `${chatId}:${text.slice(0, 64)}`); // fallback if update_id absent (shouldn't happen)
  const outcome = await withIdempotency(key, dbIdempotencyRepo(), async () => {
    const auth = await authedGmailFor(userId, e);
    const store = await dbMemoryStore(userId);
    const settings = effectiveSettings(await dbSettingsRepo().get(userId), e.OWNER_TZ);
    const reply = await handleMessage(text, {
      userId, gmail: googleGmailClient(auth), memory: store,
      llm: geminiProvider(e.GEMINI_API_KEY), convo: dbConversationRepo(),
      proposals: dbProposalRepo(), actionLog: dbActionLogRepo(),
      tools: [...readOnlyTools(), ...trashTools()], timezone: settings.timezone, language: settings.language,
    });
    await store.flush();
    const bot = new Bot(e.TELEGRAM_BOT_TOKEN);
    log("worker.reply", { updateId, userId, replyLen: reply.length, reply: logPreview(reply, 1200) });
    await sendFormatted(bot, chatId, reply);
    return { ok: true as const };
  });
  if (!outcome.processed) {
    log("worker.dup", { key });
    return Response.json({ ok: true, duplicate: true });
  }
  log("worker.done", { updateId, userId, ms: Date.now() - t0 });
  return Response.json(outcome.result);
}
