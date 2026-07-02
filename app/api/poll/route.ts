// app/api/poll/route.ts
import { env } from "../../../src/config/env.js";
import { verifyQStash } from "../../../src/queue/qstash.js";
import { authedGmailFor } from "../../../src/oauth/google.js";
import { googleGmailClient } from "../../../src/gmail/client.js";
import { geminiProvider } from "../../../src/llm/gemini.js";
import { dbMemoryStore, dbSeenRepo, dbSyncRepo } from "../../../src/db/adapters.js";
import { dbConversationRepo } from "../../../src/db/conversation-adapter.js";
import { dbTelegramLinkRepo, dbUserDirectory } from "../../../src/db/user-adapters.js";
import { runPoll } from "../../../src/notifier/poll.js";
import { generateBrief } from "../../../src/notifier/brief.js";
import { pollAllUsers } from "../../../src/notifier/fanout.js";
import { sendFormatted } from "../../../src/telegram/send.js";
import { Bot } from "grammy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const e = env();
  await verifyQStash(e, req);
  const llm = geminiProvider(e.GEMINI_API_KEY);
  const bot = new Bot(e.TELEGRAM_BOT_TOKEN);
  const summary = await pollAllUsers({
    ownerTelegramId: e.TELEGRAM_OWNER_ID,
    links: dbTelegramLinkRepo(),
    directory: dbUserDirectory(),
    pollUser: async (userId, chatId) => {
      const auth = await authedGmailFor(userId, e);
      const gmail = googleGmailClient(auth);
      const res = await runPoll({ userId, gmail, store: await dbMemoryStore(userId), llm, sync: dbSyncRepo(), seen: dbSeenRepo() });
      if (res.firstRun) return;
      const ids = res.important.map(i => i.messageId);
      if (ids.length === 0) { await res.commit(); return; }
      let brief = await generateBrief(ids, { gmail, llm, timezone: e.OWNER_TZ });
      if (!brief || brief.trim() === "") {
        brief = `${ids.length} new important email(s):\n` +
          res.important.map(i => `• ${i.subject || "(no subject)"} — ${i.from}`).join("\n");
      }
      await sendFormatted(bot, chatId, brief);
      await dbConversationRepo().appendTurn(userId, { role: "brief", content: brief });
      await res.commit();
    },
  });
  return Response.json({ ok: true, ...summary });
}
