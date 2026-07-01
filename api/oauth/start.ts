// api/oauth/start.ts — begins the Google OAuth consent flow (owner-guarded).
// Visit https://<app>/api/oauth/start?key=<SETUP_SECRET> in a browser once to connect Gmail.
import { randomBytes } from "node:crypto";
import { env } from "../../src/config/env.js";
import { buildAuthUrl } from "../../src/oauth/google.js";
import { isSetupAuthorized } from "../../src/setup/auth.js";
import { searchParam } from "../../src/http/url.js";

export async function GET(req: Request): Promise<Response> {
  const e = env();
  const expected = e.SETUP_SECRET;
  if (!expected) return new Response("setup not configured (SETUP_SECRET unset)", { status: 500 });
  const key = searchParam(req.url, "key");
  if (!isSetupAuthorized(key, expected)) return new Response("forbidden", { status: 403 });
  const state = randomBytes(16).toString("hex");
  return new Response(null, { status: 302, headers: { Location: buildAuthUrl(e, state) } });
}
