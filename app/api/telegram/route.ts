// app/api/telegram/route.ts
import { env } from "../../../src/config/env.js";
import { enqueue } from "../../../src/queue/qstash.js";
import { isAuthorizedTelegram } from "../../../src/users/identity.js";
import { dbTelegramLinkRepo } from "../../../src/db/user-adapters.js";
import { log, logPreview } from "../../../src/util/log.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const e = env();
  if (req.headers.get("x-telegram-bot-api-secret-token") !== e.TELEGRAM_WEBHOOK_SECRET) {
    log("telegram.forbidden", {}); // wrong/missing webhook secret — no secret is logged
    return new Response("forbidden", { status: 403 });
  }
  const update = await req.json();
  const updateId = update?.update_id;
  const fromId = update?.message?.from?.id;
  const text = update?.message?.text;
  // Arrival timestamp: this is when Telegram delivered the message to us — compare
  // against worker.recv to see how long it waited in the QStash queue.
  log("telegram.recv", { updateId, fromId, textLen: typeof text === "string" ? text.length : undefined, text: typeof text === "string" ? logPreview(text, 500) : undefined });
  if (typeof fromId !== "number" || !(await isAuthorizedTelegram(e.TELEGRAM_OWNER_ID, fromId, dbTelegramLinkRepo()))) {
    log("telegram.skip", { reason: "unauthorized", updateId, fromId });
    return Response.json({ ok: true, skipped: true });
  }
  try {
    await enqueue(e, "/api/worker", update);   // ack immediately; process async
    log("telegram.enqueue", { updateId });
  } catch (err) {
    // Enqueue failed (QStash down/rate-limited) — 500 makes Telegram retry the
    // webhook later, which would delay processing. Logging it surfaces that path.
    log("telegram.enqueue_error", { updateId, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  return Response.json({ ok: true });
}
