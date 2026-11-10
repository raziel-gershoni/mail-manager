// app/api/settings/route.ts
import { env } from "../../../src/config/env.js";
import { verifyInitData } from "../../../src/telegram/initdata.js";
import { resolveUserIdForApp } from "../../../src/users/identity.js";
import { dbTelegramLinkRepo, dbUserDirectory } from "../../../src/db/user-adapters.js";
import { dbSettingsRepo } from "../../../src/db/settings-adapter.js";
import { dbGoogleAccountRepo } from "../../../src/db/google-account-adapter.js";
import { dbMemoryStore } from "../../../src/db/adapters.js";
import { dbConversationRepo } from "../../../src/db/conversation-adapter.js";
import { effectiveSettings } from "../../../src/settings/settings.js";
import { buildSettingsView, validateSettingsPatch, mergePatch } from "../../../src/settings/service.js";
import { contextUsage } from "../../../src/context/assemble.js";
import { SYSTEM_PROMPT } from "../../../src/telegram/bot.js";
import { withoutQuery } from "../../../src/util/errors.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function authUser(req: Request): Promise<{ userId: number; isOwner: boolean } | null> {
  const e = env();
  const v = verifyInitData(req.headers.get("x-telegram-init-data") ?? "", e.TELEGRAM_BOT_TOKEN, new Date());
  if (!v) return null;
  const userId = await resolveUserIdForApp(e.TELEGRAM_OWNER_ID, v.telegramUserId, dbTelegramLinkRepo(), dbUserDirectory());
  if (userId === null) return null;
  return { userId, isOwner: v.telegramUserId === e.TELEGRAM_OWNER_ID };
}

async function handleGet(req: Request): Promise<Response> {
  const e = env();
  const auth = await authUser(req);
  if (auth === null) return new Response("unauthorized", { status: 401 });
  const { userId, isOwner } = auth;
  const eff = effectiveSettings(await dbSettingsRepo().get(userId), e.OWNER_TZ);
  const account = await dbGoogleAccountRepo().getStatus(userId);
  const store = await dbMemoryStore(userId);
  const state = await dbConversationRepo().load(userId);
  const usage = contextUsage(SYSTEM_PROMPT, store.index(), state);
  // isOwner gates the owner-only provisioning UI in the mini-app.
  return Response.json({ ...buildSettingsView(eff, account, store.list(), usage), isOwner });
}

// An error that escapes leaves without the SQL and params drizzle puts in its message, so
// Next's own uncaught-error log stays clean. Still a throw, so the status stays a 500.
export async function GET(req: Request): Promise<Response> {
  try {
    return await handleGet(req);
  } catch (err) {
    throw withoutQuery(err);
  }
}

async function handlePost(req: Request): Promise<Response> {
  const e = env();
  const auth = await authUser(req);
  if (auth === null) return new Response("unauthorized", { status: 401 });
  const { userId } = auth;
  const patch = validateSettingsPatch(await req.json().catch(() => null));
  if ("error" in patch) return Response.json({ error: patch.error }, { status: 400 });
  const eff = effectiveSettings(await dbSettingsRepo().get(userId), e.OWNER_TZ);
  await dbSettingsRepo().upsert(userId, mergePatch(eff, patch));
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
