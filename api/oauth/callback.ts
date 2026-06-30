// api/oauth/callback.ts
import { env } from "../../src/config/env.js";
import { exchangeAndStore } from "../../src/oauth/google.js";

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return new Response("missing code", { status: 400 });
  try {
    const { email } = await exchangeAndStore(env(), code);
    return new Response(`Connected ${email}. You can close this tab.`, { status: 200 });
  } catch (e) {
    console.error("oauth callback error", e);
    return new Response("OAuth failed — check the server logs.", { status: 500 });
  }
}
