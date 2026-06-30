import type { GmailClient } from "../gmail/client.js";
import type { MemoryStore } from "../memory/store.js";
import type { LLMProvider } from "../llm/provider.js";
import type { SyncStateRepo, SeenRepo } from "./sync.js";
import type { DigestItem } from "./digest.js";
import { classifyEmail } from "./classify.js";

export interface PollDeps {
  userId: number; gmail: GmailClient; store: MemoryStore; llm: LLMProvider;
  sync: SyncStateRepo; seen: SeenRepo;
}
export interface PollResult { firstRun: boolean; important: DigestItem[]; processed: number; }

export async function runPoll(deps: PollDeps): Promise<PollResult> {
  const cursor = await deps.sync.get(deps.userId);
  if (cursor === null) {
    await deps.sync.set(deps.userId, await deps.gmail.currentHistoryId());
    return { firstRun: true, important: [], processed: 0 };
  }
  const ids = await deps.gmail.listAddedMessageIds(cursor);
  const important: DigestItem[] = [];
  let processed = 0;
  for (const id of ids) {
    if (await deps.seen.has(deps.userId, id)) continue;
    processed++;
    const email = await deps.gmail.getMeta(id);
    const outcome = await classifyEmail(email, { store: deps.store, llm: deps.llm });
    const verdict = outcome.important ? "important" : outcome.suspicious ? "suspicious" : "unimportant";
    await deps.seen.record(deps.userId, { messageId: id, surfaced: outcome.important, verdict, reason: outcome.reason });
    if (outcome.important) important.push({ messageId: id, from: email.from, subject: email.subject, reason: outcome.reason });
  }
  await deps.sync.set(deps.userId, await deps.gmail.currentHistoryId());
  return { firstRun: false, important, processed };
}
