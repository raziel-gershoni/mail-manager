// api/poll.ts
import { env } from "../src/config/env.js";
import { verifyQStash } from "../src/queue/qstash.js";
import { authedGmailFor } from "../src/oauth/google.js";
import { googleGmailClient } from "../src/gmail/client.js";
import { geminiProvider } from "../src/llm/gemini.js";
import { dbMemoryStore, dbSeenRepo, dbSyncRepo } from "../src/db/adapters.js";
import { dbConversationRepo } from "../src/db/conversation-adapter.js";
import { runPoll } from "../src/notifier/poll.js";
import { generateBrief } from "../src/notifier/brief.js";
import { Bot } from "grammy";

const USER_ID = 1;

export async function POST(req: Request): Promise<Response> {
  const e = env();
  await verifyQStash(e, req);
  const auth = await authedGmailFor(USER_ID, e);
  const gmail = googleGmailClient(auth);
  const llm = geminiProvider(e.GEMINI_API_KEY);
  const res = await runPoll({ userId: USER_ID, gmail, store: await dbMemoryStore(USER_ID), llm, sync: dbSyncRepo(), seen: dbSeenRepo() });
  if (res.firstRun) return Response.json({ ok: true, firstRun: true });
  const ids = res.important.map(i => i.messageId);
  if (ids.length === 0) {
    await res.commit();
    return Response.json({ ok: true, important: 0 });
  }
  let brief = await generateBrief(ids, { gmail, llm });
  if (!brief || brief.trim() === "") {
    brief = `${ids.length} new important email(s):\n` +
      res.important.map(i => `• ${i.subject || "(no subject)"} — ${i.from}`).join("\n");
  }
  const bot = new Bot(e.TELEGRAM_BOT_TOKEN);
  await bot.api.sendMessage(e.TELEGRAM_OWNER_ID, brief);
  await dbConversationRepo().appendTurn(USER_ID, { role: "brief", content: brief });
  await res.commit();
  return Response.json({ ok: true, important: res.important.length });
}
