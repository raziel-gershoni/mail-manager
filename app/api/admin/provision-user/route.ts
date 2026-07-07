// app/api/admin/provision-user/route.ts — owner-only second-user provisioning,
// called from the mini-app. Auth is the mini-app's Telegram initData, gated to the
// bootstrap owner (TELEGRAM_OWNER_ID). Returns a Google consent URL for the owner
// to hand to the second user, who grants access to THEIR OWN Gmail.
import { randomBytes } from "node:crypto";
import { env } from "../../../../src/config/env.js";
import { verifyInitData } from "../../../../src/telegram/initdata.js";
import { buildAuthUrl, createUser } from "../../../../src/oauth/google.js";
import { dbTelegramLinkRepo } from "../../../../src/db/user-adapters.js";
import { dbSettingsRepo } from "../../../../src/db/settings-adapter.js";
import { dbOAuthStateRepo } from "../../../../src/db/oauth-state-adapter.js";
import { PROVISION_STATE_TTL_MS } from "../../../../src/oauth/reconnect.js";
import { parseProvisionBody, provisionUser } from "../../../../src/oauth/provision.js";
import { log } from "../../../../src/util/log.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const e = env();
  // Owner-only: verify the Mini App initData, then require the bootstrap owner id.
  const v = verifyInitData(req.headers.get("x-telegram-init-data") ?? "", e.TELEGRAM_BOT_TOKEN, new Date());
  if (!v || v.telegramUserId !== e.TELEGRAM_OWNER_ID) return new Response("forbidden", { status: 403 });

  const parsed = parseProvisionBody(await req.json().catch(() => null));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const result = await provisionUser({
    createUser,
    links: dbTelegramLinkRepo(),
    settings: dbSettingsRepo(),
    states: dbOAuthStateRepo(),
    buildConsentUrl: (state) => buildAuthUrl(e, state),
    genState: () => randomBytes(16).toString("hex"),
    ttlMs: PROVISION_STATE_TTL_MS,
  }, parsed, new Date());

  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  // Log the event WITHOUT the consent URL (it authorizes a Gmail grant).
  log("provision.created", { userId: result.userId, telegramUserId: parsed.telegramUserId, language: parsed.language });
  return Response.json(result);
}
