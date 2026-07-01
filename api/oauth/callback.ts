// api/oauth/callback.ts
import { env } from "../../src/config/env.js";
import { exchangeAndStore } from "../../src/oauth/google.js";
import { searchParam } from "../../src/http/url.js";

export async function GET(req: Request): Promise<Response> {
  const code = searchParam(req.url, "code");
  if (!code) return new Response("missing code", { status: 400 });
  try {
    const { email } = await exchangeAndStore(env(), code);
    return new Response(`Connected ${email}. You can close this tab.`, { status: 200 });
  } catch (e) {
    console.error("oauth callback error", e);
    return new Response("OAuth failed — check the server logs.", { status: 500 });
  }
}
