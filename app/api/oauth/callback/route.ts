// app/api/oauth/callback/route.ts
import { Bot } from "grammy";
import { env } from "../../../../src/config/env.js";
import { exchangeAndStore } from "../../../../src/oauth/google.js";
import { searchParam } from "../../../../src/http/url.js";
import { escapeHtml } from "../../../../src/http/html.js";
import { dbOAuthStateRepo } from "../../../../src/db/oauth-state-adapter.js";
import { dbSettingsRepo } from "../../../../src/db/settings-adapter.js";
import { effectiveSettings } from "../../../../src/settings/settings.js";
import { t, type Lang } from "../../../../src/i18n/index.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The bot's public @username → t.me deep link. Same for every user, so cache it
// (undefined = not fetched yet, null = getMe unavailable).
let cachedBotLink: string | null | undefined;
async function botDeepLink(token: string): Promise<string | null> {
  if (cachedBotLink !== undefined) return cachedBotLink;
  try {
    const me = await new Bot(token).api.getMe();
    cachedBotLink = me.username ? `https://t.me/${me.username}` : null;
  } catch (err) {
    console.error("oauth callback getMe failed", err);
    cachedBotLink = null;
  }
  return cachedBotLink;
}

function page(messageHtml: string, redirect?: string, linkLabel?: string): Response {
  const meta = redirect ? `<meta http-equiv="refresh" content="1;url=${escapeHtml(redirect)}">` : "";
  const link = redirect && linkLabel ? `<p><a href="${escapeHtml(redirect)}">${escapeHtml(linkLabel)} →</a></p>` : "";
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${meta}<title>Mail Manager</title></head>` +
    `<body style="font-family:system-ui,sans-serif;padding:28px;max-width:480px;margin:0 auto;text-align:center;line-height:1.6">` +
    `<p style="font-size:18px">${messageHtml}</p>${link}</body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: Request): Promise<Response> {
  const e = env();
  const code = searchParam(req.url, "code");
  const state = searchParam(req.url, "state");
  if (!code || !state) return page(escapeHtml(t("en", "oauth_failed")));
  try {
    const userId = await dbOAuthStateRepo().consume(state, new Date());
    if (userId === null) return page(escapeHtml(t("en", "oauth_expired")));
    const { email } = await exchangeAndStore(e, code, userId);
    // Localize the confirmation to the (just-provisioned) user's language.
    const lang: Lang = effectiveSettings(await dbSettingsRepo().get(userId), e.OWNER_TZ).language;
    const link = await botDeepLink(e.TELEGRAM_BOT_TOKEN);
    if (link) return page(escapeHtml(t(lang, "oauth_connected", { email })), link, t(lang, "oauth_open_bot"));
    return page(escapeHtml(t(lang, "oauth_connected_manual", { email })));
  } catch (err) {
    console.error("oauth callback error", err);
    return page(escapeHtml(t("en", "oauth_failed")));
  }
}
