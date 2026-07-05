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
import { generateBrief, composePollMessage } from "../../../src/notifier/brief.js";
import { pollAllUsers } from "../../../src/notifier/fanout.js";
import { sendFormatted } from "../../../src/telegram/send.js";
import { log } from "../../../src/util/log.js";
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
    pollUser: async (userId, chatId, timezone) => {
      try {
        const auth = await authedGmailFor(userId, e);
        const gmail = googleGmailClient(auth);
        const res = await runPoll({ userId, gmail, store: await dbMemoryStore(userId), llm, sync: dbSyncRepo(), seen: dbSeenRepo(), actionLog: dbActionLogRepo() });
        if (res.firstRun) return;
        const ids = res.important.map(i => i.messageId);
        let brief: string | null = null;
        if (ids.length > 0) {
          brief = await generateBrief(ids, { gmail, llm, timezone });
          if (!brief || brief.trim() === "") {
            brief = `${ids.length} new important email(s):\n` +
              res.important.map(i => `• ${i.subject || "(no subject)"} — ${i.from}`).join("\n");
          }
        }
        // Report every cycle (heartbeat when nothing arrived; activity otherwise).
        // Only genuinely-important mail buzzes the phone — routine reports and
        // heartbeats go as silent notifications, and only real briefs are stored
        // in the conversation (so 48 heartbeats/day don't bloat the context).
        const hasImportant = res.important.length > 0;
        const message = composePollMessage(brief, { processed: res.processed, surfaced: res.important.length, trashed: res.guardedTrashed, archived: res.guardedArchived });
        await sendFormatted(bot, chatId, message, { silent: !hasImportant });
        if (hasImportant) await dbConversationRepo().appendTurn(userId, { role: "brief", content: message });
        await res.commit();
        log("poll.brief", { userId, important: ids.length, processed: res.processed, guardedTrashed: res.guardedTrashed, guardedArchived: res.guardedArchived });
      } catch (err) {
        if (isInvalidGrant(err)) {
          log("poll.reconnect", { userId });
          const newlyFlagged = await dbGoogleAccountRepo().markNeedsReconnect(userId);
          if (newlyFlagged) await sendFormatted(bot, chatId, reconnectNudgeText());
          return; // handled; do not advance the cursor (res.commit only runs on success above)
        }
        throw err; // let the fan-out isolate and count other errors
      }
    },
  });
  log("poll.done", { ...summary, ms: Date.now() - t0 });
  return Response.json({ ok: true, ...summary });
}
