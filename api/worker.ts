// api/worker.ts
import { env } from "../src/config/env.js";
import { verifyQStash } from "../src/queue/qstash.js";
import { buildBot } from "../src/telegram/bot.js";
import { authedGmailFor } from "../src/oauth/google.js";
import { googleGmailClient } from "../src/gmail/client.js";
import { dbMemoryStore, dbSeenRepo } from "../src/db/adapters.js";

const USER_ID = 1;

export default async function handler(req: Request): Promise<Response> {
  const e = env();
  const update = await verifyQStash(e, req);
  const auth = await authedGmailFor(USER_ID, e);
  const gmail = googleGmailClient(auth);
  const store = await dbMemoryStore(USER_ID);
  const bot = buildBot(e, {
    store, seen: dbSeenRepo(), userId: USER_ID,
    gmailFromEmail: async (id) => (await gmail.getMeta(id)).fromEmail,
  });
  await bot.init();
  await bot.handleUpdate(update as any);
  await store.flush();
  return Response.json({ ok: true });
}
