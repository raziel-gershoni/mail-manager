import type { GmailClient } from "../gmail/client.js";
import type { MemoryStore } from "../memory/store.js";
import type { LLMProvider } from "../llm/provider.js";
import type { SyncStateRepo, SeenRepo } from "./sync.js";
import { classifyEmail } from "./classify.js";

export interface DigestItem { messageId: string; from: string; subject: string; reason: string; }

export interface PollDeps {
  userId: number; gmail: GmailClient; store: MemoryStore; llm: LLMProvider;
  sync: SyncStateRepo; seen: SeenRepo;
}
export interface PollResult {
  firstRun: boolean;
  important: DigestItem[];
  processed: number;
  commit: () => Promise<void>;
}

export async function runPoll(deps: PollDeps): Promise<PollResult> {
  // Capture the head history id ONCE, before listing, so the cursor we eventually
  // advance to cannot race past messages that arrive mid-poll.
  const headId = await deps.gmail.currentHistoryId();
  const cursor = await deps.sync.get(deps.userId);
  if (cursor === null) {
    await deps.sync.set(deps.userId, headId);
    return { firstRun: true, important: [], processed: 0, commit: async () => {} };
  }
  const ids = await deps.gmail.listAddedMessageIds(cursor);
  const important: DigestItem[] = [];
  const toCommit: { id: string; reason: string }[] = [];
  let processed = 0;
  for (const id of ids) {
    if (await deps.seen.has(deps.userId, id)) continue;
    processed++;
    const email = await deps.gmail.getMeta(id);
    const outcome = await classifyEmail(email, { store: deps.store, llm: deps.llm });
    if (outcome.important) {
      // Defer marking-seen + cursor advance until the digest is delivered.
      important.push({ messageId: id, from: email.from, subject: email.subject, reason: outcome.reason });
      toCommit.push({ id, reason: outcome.reason });
    } else {
      // Not surfaced to the user, so recording now is safe and avoids re-classifying on retry.
      const verdict = outcome.suspicious ? "suspicious" : "unimportant";
      await deps.seen.record(deps.userId, { messageId: id, surfaced: false, verdict, reason: outcome.reason });
    }
  }
  const commit = async (): Promise<void> => {
    for (const c of toCommit) {
      await deps.seen.record(deps.userId, { messageId: c.id, surfaced: true, verdict: "important", reason: c.reason });
    }
    await deps.sync.set(deps.userId, headId);
  };
  return { firstRun: false, important, processed, commit };
}
