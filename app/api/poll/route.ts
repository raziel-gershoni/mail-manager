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
import { generateBrief } from "../../../src/notifier/brief.js";
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
        // The background poll may have trashed junk from guarded senders — always
        // report it so nothing is trashed silently.
        const guardNote = res.guardedTrashed > 0
          ? `_Guarded: trashed ${res.guardedTrashed} junk from watched senders (say “undo” to restore)._`
          : "";
        if (ids.length === 0) {
          if (guardNote) {
            await sendFormatted(bot, chatId, guardNote);
            await dbConversationRepo().appendTurn(userId, { role: "brief", content: guardNote });
          }
          await res.commit();
          log("poll.brief", { userId, important: 0, guardedTrashed: res.guardedTrashed });
          return;
        }
        let brief = await generateBrief(ids, { gmail, llm, timezone });
        if (!brief || brief.trim() === "") {
          brief = `${ids.length} new important email(s):\n` +
            res.important.map(i => `• ${i.subject || "(no subject)"} — ${i.from}`).join("\n");
        }
        const message = guardNote ? `${brief}\n\n${guardNote}` : brief;
        await sendFormatted(bot, chatId, message);
        await dbConversationRepo().appendTurn(userId, { role: "brief", content: message });
        await res.commit();
        log("poll.brief", { userId, important: ids.length, guardedTrashed: res.guardedTrashed });
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
