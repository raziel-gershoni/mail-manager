// api/telegram.ts
import { env } from "../src/config/env.js";
import { enqueue } from "../src/queue/qstash.js";

export default async function handler(req: Request): Promise<Response> {
  const e = env();
  if (req.headers.get("x-telegram-bot-api-secret-token") !== e.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await req.json();
  await enqueue(e, "/api/worker", update);   // ack immediately; process async
  return Response.json({ ok: true });
}
