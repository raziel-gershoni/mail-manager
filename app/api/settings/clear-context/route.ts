// app/api/settings/clear-context/route.ts — wipes the owner's conversation history from the mini app.
// Learned rules live in a separate table and are NOT touched.
import { env } from "../../../../src/config/env.js";
import { verifyInitData } from "../../../../src/telegram/initdata.js";
import { resolveUserIdForApp } from "../../../../src/users/identity.js";
import { dbTelegramLinkRepo, dbUserDirectory } from "../../../../src/db/user-adapters.js";
import { dbConversationRepo } from "../../../../src/db/conversation-adapter.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const e = env();
  const v = verifyInitData(req.headers.get("x-telegram-init-data") ?? "", e.TELEGRAM_BOT_TOKEN, new Date());
  if (!v) return new Response("unauthorized", { status: 401 });
  const userId = await resolveUserIdForApp(e.TELEGRAM_OWNER_ID, v.telegramUserId, dbTelegramLinkRepo(), dbUserDirectory());
  if (userId === null) return new Response("unauthorized", { status: 401 });
  await dbConversationRepo().clear(userId);
  return Response.json({ ok: true });
}
