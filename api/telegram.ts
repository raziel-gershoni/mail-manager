// api/telegram.ts
import { env } from "../src/config/env.js";
import { enqueue } from "../src/queue/qstash.js";
import { isAllowed } from "../src/telegram/bot.js";

export async function POST(req: Request): Promise<Response> {
  const e = env();
  if (req.headers.get("x-telegram-bot-api-secret-token") !== e.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await req.json();
  const fromId = update?.message?.from?.id;
  if (!isAllowed(e.TELEGRAM_OWNER_ID, fromId)) {
    return Response.json({ ok: true, skipped: true });
  }
  await enqueue(e, "/api/worker", update);   // ack immediately; process async
  return Response.json({ ok: true });
}
