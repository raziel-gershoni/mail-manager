// app/api/settings/reconnect/route.ts — mints a user-bound Google OAuth URL for the mini app.
import { randomBytes } from "node:crypto";
import { env } from "../../../../src/config/env.js";
import { verifyInitData } from "../../../../src/telegram/initdata.js";
import { resolveUserIdForApp } from "../../../../src/users/identity.js";
import { dbTelegramLinkRepo, dbUserDirectory } from "../../../../src/db/user-adapters.js";
import { dbOAuthStateRepo } from "../../../../src/db/oauth-state-adapter.js";
import { buildAuthUrl } from "../../../../src/oauth/google.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const e = env();
  const v = verifyInitData(req.headers.get("x-telegram-init-data") ?? "", e.TELEGRAM_BOT_TOKEN, new Date());
  if (!v) return new Response("unauthorized", { status: 401 });
  const userId = await resolveUserIdForApp(e.TELEGRAM_OWNER_ID, v.telegramUserId, dbTelegramLinkRepo(), dbUserDirectory());
  if (userId === null) return new Response("unauthorized", { status: 401 });
  const state = randomBytes(16).toString("hex");
  await dbOAuthStateRepo().create(state, userId);
  return Response.json({ url: buildAuthUrl(e, state) });
}
