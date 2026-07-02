// app/api/settings/route.ts
import { env } from "../../../src/config/env.js";
import { verifyInitData } from "../../../src/telegram/initdata.js";
import { resolveUserIdForApp } from "../../../src/users/identity.js";
import { dbTelegramLinkRepo, dbUserDirectory } from "../../../src/db/user-adapters.js";
import { dbSettingsRepo } from "../../../src/db/settings-adapter.js";
import { dbGoogleAccountRepo } from "../../../src/db/google-account-adapter.js";
import { dbMemoryStore } from "../../../src/db/adapters.js";
import { effectiveSettings } from "../../../src/settings/settings.js";
import { buildSettingsView, validateSettingsPatch, mergePatch } from "../../../src/settings/service.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function authUser(req: Request): Promise<number | null> {
  const e = env();
  const v = verifyInitData(req.headers.get("x-telegram-init-data") ?? "", e.TELEGRAM_BOT_TOKEN, new Date());
  if (!v) return null;
  return resolveUserIdForApp(e.TELEGRAM_OWNER_ID, v.telegramUserId, dbTelegramLinkRepo(), dbUserDirectory());
}

export async function GET(req: Request): Promise<Response> {
  const e = env();
  const userId = await authUser(req);
  if (userId === null) return new Response("unauthorized", { status: 401 });
  const eff = effectiveSettings(await dbSettingsRepo().get(userId), e.OWNER_TZ);
  const account = await dbGoogleAccountRepo().getStatus(userId);
  const rules = (await dbMemoryStore(userId)).list();
  return Response.json(buildSettingsView(eff, account, rules));
}

export async function POST(req: Request): Promise<Response> {
  const e = env();
  const userId = await authUser(req);
  if (userId === null) return new Response("unauthorized", { status: 401 });
  const patch = validateSettingsPatch(await req.json().catch(() => null));
  if ("error" in patch) return Response.json({ error: patch.error }, { status: 400 });
  const eff = effectiveSettings(await dbSettingsRepo().get(userId), e.OWNER_TZ);
  await dbSettingsRepo().upsert(userId, mergePatch(eff, patch));
  return Response.json({ ok: true });
}
