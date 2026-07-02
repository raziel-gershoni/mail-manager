// app/api/oauth/callback/route.ts
import { env } from "../../../../src/config/env.js";
import { exchangeAndStore } from "../../../../src/oauth/google.js";
import { searchParam } from "../../../../src/http/url.js";
import { dbOAuthStateRepo } from "../../../../src/db/oauth-state-adapter.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const code = searchParam(req.url, "code");
  const state = searchParam(req.url, "state");
  if (!code || !state) return new Response("missing code or state", { status: 400 });
  try {
    const userId = await dbOAuthStateRepo().consume(state, new Date());
    if (userId === null) return new Response("invalid or expired state", { status: 403 });
    const { email } = await exchangeAndStore(env(), code, userId);
    return new Response(`Connected ${email}. You can close this tab.`, { status: 200 });
  } catch (e) {
    console.error("oauth callback error", e);
    return new Response("OAuth failed — check the server logs.", { status: 500 });
  }
}
