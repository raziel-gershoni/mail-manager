// app/api/settings/clear-context/route.ts — wipes the owner's conversation history from the mini app.
// Learned rules live in a separate table and are NOT touched.
import { env } from "../../../../src/config/env.js";
import { verifyInitData } from "../../../../src/telegram/initdata.js";
import { resolveUserIdForApp } from "../../../../src/users/identity.js";
import { dbTelegramLinkRepo, dbUserDirectory } from "../../../../src/db/user-adapters.js";
import { dbConversationRepo } from "../../../../src/db/conversation-adapter.js";
import { withoutQuery } from "../../../../src/util/errors.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handlePost(req: Request): Promise<Response> {
  const e = env();
  const v = verifyInitData(req.headers.get("x-telegram-init-data") ?? "", e.TELEGRAM_BOT_TOKEN, new Date());
  if (!v) return new Response("unauthorized", { status: 401 });
  const userId = await resolveUserIdForApp(e.TELEGRAM_OWNER_ID, v.telegramUserId, dbTelegramLinkRepo(), dbUserDirectory());
  if (userId === null) return new Response("unauthorized", { status: 401 });
  await dbConversationRepo().clear(userId);
  return Response.json({ ok: true });
}

// An error that escapes leaves without the SQL and params drizzle puts in its message, so
// Next's own uncaught-error log stays clean. Still a throw, so the status stays a 500.
export async function POST(req: Request): Promise<Response> {
  try {
    return await handlePost(req);
  } catch (err) {
    throw withoutQuery(err);
  }
}
