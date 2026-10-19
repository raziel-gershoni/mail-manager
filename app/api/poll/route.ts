// app/api/poll/route.ts
import { env } from "../../../src/config/env.js";
import { verifyQStash } from "../../../src/queue/qstash.js";
import { authedGmailFor } from "../../../src/oauth/google.js";
import { dbGoogleAccountRepo } from "../../../src/db/google-account-adapter.js";
import { isInvalidGrant, reconnectNudgeText } from "../../../src/oauth/reconnect.js";
import { googleGmailClient } from "../../../src/gmail/client.js";
import { geminiProvider } from "../../../src/llm/gemini.js";
import { dbMemoryStore, dbSeenRepo, dbSyncRepo } from "../../../src/db/adapters.js";
import { dbActionLogRepo } from "../../../src/db/cleanup-adapters.js";
import { dbConversationRepo } from "../../../src/db/conversation-adapter.js";
import { dbTelegramLinkRepo, dbUserDirectory } from "../../../src/db/user-adapters.js";
import { dbSettingsRepo } from "../../../src/db/settings-adapter.js";
import { effectiveSettings } from "../../../src/settings/settings.js";
import { runPoll } from "../../../src/notifier/poll.js";
import { activityItemsFrom } from "../../../src/notifier/activity.js";
import { dbActivityRepo } from "../../../src/db/activity-adapter.js";
import { buildDigestRefs } from "../../../src/notifier/refs.js";
import { dbDigestRefRepo } from "../../../src/db/refs-adapter.js";
import { dbOpsEventRepo } from "../../../src/db/ops-events-adapter.js";
import { recordOpsEvent, recordPollOutcome } from "../../../src/ops/events.js";
import { generateBrief, composePollMessage, pollSilent, BRIEF_ATTACHMENT_GRACE_MS } from "../../../src/notifier/brief.js";
import { pollAllUsers, POLL_LOOP_BUDGET_MS } from "../../../src/notifier/fanout.js";
import { runWeeklyTasks } from "../../../src/weekly/run.js";
import { dbWeeklyRunRepo } from "../../../src/db/weekly-runs-adapter.js";
import { sendFormatted, sendPlain } from "../../../src/telegram/send.js";
import { log } from "../../../src/util/log.js";
import { t } from "../../../src/i18n/index.js";
import { Bot } from "grammy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Hobby + Fluid compute allows up to 300s

export async function POST(req: Request): Promise<Response> {
  const t0 = Date.now();
  const e = env();
  await verifyQStash(e, req);
  log("poll.start", {});
  const llm = geminiProvider(e.GEMINI_API_KEY);
  const bot = new Bot(e.TELEGRAM_BOT_TOKEN);
  const settingsRepo = dbSettingsRepo();
  const ops = dbOpsEventRepo();
  const summary = await pollAllUsers({
    ownerTelegramId: e.TELEGRAM_OWNER_ID,
    links: dbTelegramLinkRepo(),
    directory: dbUserDirectory(),
    now: new Date(),
    settingsFor: async (userId) => effectiveSettings(await settingsRepo.get(userId), e.OWNER_TZ),
    // A failed user poll becomes a poll_errored ops event for the weekly retrospect.
    // recordOpsEvent never throws, and the fan-out guards the hook as well.
    onUserError: (userId, err) => recordOpsEvent(ops, userId, "poll_errored", { error: err instanceof Error ? err.message : String(err) }),
    pollUser: async (userId, chatId, timezone, language, deadline) => {
      try {
        const auth = await authedGmailFor(userId, e);
        const gmail = googleGmailClient(auth);
        const store = await dbMemoryStore(userId);
        const res = await runPoll({ userId, gmail, store, llm, sync: dbSyncRepo(), seen: dbSeenRepo(), actionLog: dbActionLogRepo(), deadline });
        if (res.firstRun) return;
        // A catch-up that ran out of time, or an expired cursor, is an ops event for the
        // weekly retrospect. Recorded as soon as runPoll reports it; never throws.
        await recordPollOutcome(ops, userId, res);
        const ids = res.important.map(i => i.messageId);
        let brief: string | null = null;
        if (ids.length > 0) {
          // Attachment reads may start until 40s past the loop deadline (run start + 240s);
          // later than that the brief names the files only.
          brief = await generateBrief(ids, { gmail, llm, timezone, language, store, readAttachmentsBy: deadline + BRIEF_ATTACHMENT_GRACE_MS });
          if (!brief || brief.trim() === "") {
            brief = `${t(language, "poll_fallback_head", { n: ids.length })}\n` +
              res.important.map(i => `• ${i.subject || t(language, "poll_no_subject")} — ${i.from}`).join("\n");
          }
        }
        // Report every cycle (heartbeat when nothing arrived; activity otherwise).
        // Only genuinely-important mail buzzes the phone — routine reports and
        // heartbeats go as silent notifications, and only real briefs are stored
        // in the conversation (so 24 heartbeats/day don't bloat the context).
        const hasImportant = res.important.length > 0;
        const trashed = res.guardedTrashed + res.plainTrashed + res.prefTrashed;
        const archived = res.guardedArchived + res.plainArchived + res.prefArchived;
        const message = composePollMessage(brief, { processed: res.processed, surfaced: res.important.length, trashed, archived, unruled: res.unruled, remaining: res.remaining, cursorExpired: res.cursorExpired }, language);
        const sentId = await sendFormatted(bot, chatId, message, { silent: pollSilent(hasImportant, res.remaining, res.cursorExpired) });
        // Only genuinely-important briefs are stored in the conversation context.
        // Routine activity is NOT auto-stored — it goes to the activity log instead
        // (queryable on demand via the recent_activity tool), keeping context lean.
        if (hasImportant) await dbConversationRepo().appendTurn(userId, { role: "brief", content: message });
        await res.commit();
        // Best-effort side records AFTER a successful send + commit: the activity feed
        // (queryable via recent_activity) and the digest↔email ref coupling (so a reply
        // resolves to exact ids). The digest is already delivered, so a failure here must
        // NOT fail the cycle (which would mark it errored) — log and move on.
        try {
          const activityItems = activityItemsFrom(res.acted, res.unruled);
          if (activityItems.length > 0) await dbActivityRepo().record(userId, activityItems);
          const refs = buildDigestRefs(res.important, res.acted);
          if (typeof sentId === "number" && refs.length > 0) await dbDigestRefRepo().save(userId, sentId, refs);
        } catch (err) {
          log("poll.side_record_failed", { userId, error: err instanceof Error ? err.message : String(err) });
        }
        log("poll.brief", { userId, important: ids.length, processed: res.processed, guardedTrashed: res.guardedTrashed, guardedArchived: res.guardedArchived, plainTrashed: res.plainTrashed, plainArchived: res.plainArchived, prefTrashed: res.prefTrashed, prefArchived: res.prefArchived, remaining: res.remaining });
        // The weekly jobs (spam check, retrospect) run AFTER this hour's report is sent and
        // committed, in their own try/catch: they must never mark the hourly poll errored.
        // runWeeklyTasks guards its own start time and deadline and never throws; this catch
        // covers building its dependencies. The reports quote untrusted senders, subjects and
        // reasons and carry no markdown of their own, so they go out as PLAIN text: a subject
        // like "[Verify](https://phish)" must never become a link in the bot's own message.
        try {
          await runWeeklyTasks({
            userId, chatId, timezone, language, now: Date.now, runStart: deadline - POLL_LOOP_BUDGET_MS,
            gmail, llm, store, runs: dbWeeklyRunRepo(),
            send: (text, opts) => sendPlain(bot, chatId, text, opts),
            saveRefs: (messageId, refs) => dbDigestRefRepo().save(userId, messageId, refs),
            activity: dbActivityRepo(), actionLog: dbActionLogRepo(), ops,
          });
        } catch (err) {
          log("weekly.failed", { userId, error: err instanceof Error ? err.message : String(err) });
        }
      } catch (err) {
        if (isInvalidGrant(err)) {
          log("poll.reconnect", { userId });
          await recordOpsEvent(ops, userId, "reconnect_needed"); // never throws
          const newlyFlagged = await dbGoogleAccountRepo().markNeedsReconnect(userId);
          if (newlyFlagged) await sendFormatted(bot, chatId, reconnectNudgeText(undefined, language));
          return; // handled; do not advance the cursor (res.commit only runs on success above)
        }
        throw err; // let the fan-out isolate and count other errors
      }
    },
  });
  log("poll.done", { ...summary, ms: Date.now() - t0 });
  return Response.json({ ok: true, ...summary });
}
