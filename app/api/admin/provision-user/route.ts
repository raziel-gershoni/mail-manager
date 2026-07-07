// app/api/admin/provision-user/route.ts — owner-guarded second-user provisioning.
// POST ?key=<SETUP_SECRET> with { telegramUserId, language }. Returns a Google
// consent URL to hand to the second user; THEY grant access to their own Gmail.
import { randomBytes } from "node:crypto";
import { env } from "../../../../src/config/env.js";
import { isSetupAuthorized } from "../../../../src/setup/auth.js";
import { searchParam } from "../../../../src/http/url.js";
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
  if (!e.SETUP_SECRET) return new Response("setup not configured (SETUP_SECRET unset)", { status: 500 });
  if (!isSetupAuthorized(searchParam(req.url, "key"), e.SETUP_SECRET)) return new Response("forbidden", { status: 403 });

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
  // Log the provisioning event WITHOUT the consent URL (it authorizes a Gmail grant).
  log("provision.created", { userId: result.userId, telegramUserId: parsed.telegramUserId, language: parsed.language });
  return Response.json(result);
}
