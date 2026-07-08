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
import { runPoll, shouldStoreDigest, digestTurnContent } from "../../../src/notifier/poll.js";
import { generateBrief, composePollMessage } from "../../../src/notifier/brief.js";
import { pollAllUsers } from "../../../src/notifier/fanout.js";
import { sendFormatted } from "../../../src/telegram/send.js";
import { log } from "../../../src/util/log.js";
import { t } from "../../../src/i18n/index.js";
import { Bot } from "grammy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const t0 = Date.now();
  const e = env();
  await verifyQStash(e, req);
  log("poll.start", {});
  const llm = geminiProvider(e.GEMINI_API_KEY);
  const bot = new Bot(e.TELEGRAM_BOT_TOKEN);
  const settingsRepo = dbSettingsRepo();
  const summary = await pollAllUsers({
    ownerTelegramId: e.TELEGRAM_OWNER_ID,
    links: dbTelegramLinkRepo(),
    directory: dbUserDirectory(),
    now: new Date(),
    settingsFor: async (userId) => effectiveSettings(await settingsRepo.get(userId), e.OWNER_TZ),
    pollUser: async (userId, chatId, timezone, language) => {
      try {
        const auth = await authedGmailFor(userId, e);
        const gmail = googleGmailClient(auth);
        const res = await runPoll({ userId, gmail, store: await dbMemoryStore(userId), llm, sync: dbSyncRepo(), seen: dbSeenRepo(), actionLog: dbActionLogRepo() });
        if (res.firstRun) return;
        const ids = res.important.map(i => i.messageId);
        let brief: string | null = null;
        if (ids.length > 0) {
          brief = await generateBrief(ids, { gmail, llm, timezone, language });
          if (!brief || brief.trim() === "") {
            brief = `${t(language, "poll_fallback_head", { n: ids.length })}\n` +
              res.important.map(i => `• ${i.subject || t(language, "poll_no_subject")} — ${i.from}`).join("\n");
          }
        }
        // Report every cycle (heartbeat when nothing arrived; activity otherwise).
        // Only genuinely-important mail buzzes the phone — routine reports and
        // heartbeats go as silent notifications, and only real briefs are stored
        // in the conversation (so 48 heartbeats/day don't bloat the context).
        const hasImportant = res.important.length > 0;
        const trashed = res.guardedTrashed + res.plainTrashed;
        const archived = res.guardedArchived + res.plainArchived;
        const message = composePollMessage(brief, { processed: res.processed, surfaced: res.important.length, trashed, archived, unruled: res.unruled }, language);
        await sendFormatted(bot, chatId, message, { silent: !hasImportant });
        // Store the digest to the conversation when the cycle did something the owner
        // might reply about (important mail, an action, or a new un-ruled sender) — with
        // an itemized appendix so "what was that one?" is answerable. Heartbeats aren't stored.
        if (shouldStoreDigest(hasImportant, res.acted.length, res.unruled.length)) {
          await dbConversationRepo().appendTurn(userId, { role: "brief", content: digestTurnContent(message, res.acted) });
        }
        await res.commit();
        log("poll.brief", { userId, important: ids.length, processed: res.processed, guardedTrashed: res.guardedTrashed, guardedArchived: res.guardedArchived, plainTrashed: res.plainTrashed, plainArchived: res.plainArchived });
      } catch (err) {
        if (isInvalidGrant(err)) {
          log("poll.reconnect", { userId });
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
