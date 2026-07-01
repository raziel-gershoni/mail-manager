// api/setup.ts
import { env } from "../src/config/env.js";
import { isSetupAuthorized } from "../src/setup/auth.js";
import { ensurePollSchedule } from "../src/queue/qstash.js";
import { ensureTelegramWebhook } from "../src/telegram/bot.js";

export default async function handler(req: Request): Promise<Response> {
  const e = env();
  const expected = e.SETUP_SECRET;
  if (!expected) return new Response("setup not configured", { status: 500 });
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") || null;
  if (!isSetupAuthorized(provided, expected)) return new Response("forbidden", { status: 403 });
  if (req.method !== "POST") return new Response("use POST", { status: 405 });
  const schedule = await ensurePollSchedule(e);
  const webhook = await ensureTelegramWebhook(e);
  return Response.json({ ok: true, schedule, webhook });
}
