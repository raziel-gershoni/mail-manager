// app/api/worker-failed/route.ts
// QStash calls this after it has exhausted every retry for a conversational turn.
// It is the last line of defence against silence: by the time we get here the owner
// has been waiting with no reply and no further attempt is coming.
import { env } from "../../../src/config/env.js";
import { verifyQStash } from "../../../src/queue/qstash.js";
import { parseFailureBody } from "../../../src/queue/failure.js";
import { resolveUserIdForApp } from "../../../src/users/identity.js";
import { dbTelegramLinkRepo, dbUserDirectory } from "../../../src/db/user-adapters.js";
import { dbSettingsRepo } from "../../../src/db/settings-adapter.js";
import { dbOpsEventRepo } from "../../../src/db/ops-events-adapter.js";
import { recordOpsEvent } from "../../../src/ops/events.js";
import { effectiveSettings } from "../../../src/settings/settings.js";
import { sendFormatted } from "../../../src/telegram/send.js";
import { log } from "../../../src/util/log.js";
import { t, type Lang } from "../../../src/i18n/index.js";
import { telegramBot } from "../../../src/telegram/client.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const e = env();
  // A bad signature is not a failed turn — it is someone else knocking. Reject it
  // rather than swallowing it into a 200, so nobody can make the bot message a chat.
  let body: unknown;
  try {
    body = await verifyQStash(e, req);
  } catch {
    log("worker_failed.forbidden", {});
    return new Response("forbidden", { status: 403 });
  }

  // Everything below is best-effort. A failure handler that throws would be retried
  // by QStash and could apologise repeatedly, so it always reports success.
  try {
    const failed = parseFailureBody(body);
    if (!failed) {
      log("worker_failed.skip", { reason: "unparseable" });
      return Response.json({ ok: true, skipped: true });
    }
    let language: Lang = "en";
    let userId: number | null = null;
    if (typeof failed.fromId === "number") {
      // Read-only resolution on purpose: a failure handler must not create links or
      // otherwise mutate state. The link already exists — the turn got far enough to
      // be queued.
      userId = await resolveUserIdForApp(e.TELEGRAM_OWNER_ID, failed.fromId, dbTelegramLinkRepo(), dbUserDirectory());
      if (userId !== null) language = effectiveSettings(await dbSettingsRepo().get(userId), e.OWNER_TZ).language;
    }
    // The one write this handler makes: a worker_failed ops event for the weekly
    // retrospect. recordOpsEvent never throws, so it can't block the apology below. A
    // turn with no resolvable user can't be attributed, so it is only logged.
    if (userId !== null) await recordOpsEvent(dbOpsEventRepo(), userId, "worker_failed", { updateId: failed.updateId ?? null });
    log("worker_failed.notify", { updateId: failed.updateId, chatId: failed.chatId });
    await sendFormatted(telegramBot(e.TELEGRAM_BOT_TOKEN), failed.chatId, t(language, "turn_failed"));
  } catch (err) {
    log("worker_failed.error", { error: err instanceof Error ? err.message : String(err) });
  }
  return Response.json({ ok: true });
}
