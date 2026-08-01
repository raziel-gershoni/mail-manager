// src/queue/idempotency.ts

// How long a claim may sit unfinished before a retry is allowed to take it over.
// Vercel kills the function at its 60s maxDuration, so a claim older than this
// CANNOT belong to a still-running attempt — the previous worker is provably dead.
//
// This exists because a killed function runs no catch and no finally: without a
// takeover rule the claim survived forever, the QStash retry saw it, returned 200,
// and QStash recorded a successful delivery. The owner's message was then never
// answered and never retried — silent, permanent loss.
export const CLAIM_STALE_MS = 90_000;

export interface IdempotencyRepo {
  claim(updateId: string): Promise<boolean>;  // true iff this worker now owns the update
  release(updateId: string): Promise<void>;   // failed — let a retry have it
  complete(updateId: string): Promise<void>;  // finished — never run this update again
}

// Run fn at most once per updateId.
//
// Three states, not two. A COMPLETED update is never re-run, no matter how late a
// duplicate arrives. An update claimed recently is a genuine duplicate delivery and
// is skipped. An update claimed longer ago than a function can live is a corpse: the
// retry takes it over and runs it, which is the only way a killed turn ever gets an
// answer. Re-running can repeat side effects — accepted deliberately, because Gmail
// trash/archive are idempotent and every mutation is action-logged before it happens,
// so undo_last still covers it.
export async function withIdempotency<T>(
  updateId: string, repo: IdempotencyRepo, fn: () => Promise<T>,
): Promise<{ processed: true; result: T } | { processed: false }> {
  const claimed = await repo.claim(updateId);
  if (!claimed) return { processed: false };
  let result: T;
  try {
    result = await fn();
  } catch (e) {
    await repo.release(updateId);
    throw e;
  }
  // Only a turn that actually finished is sealed. Marking completion inside the try
  // would let a failure in complete() look like a failed turn and trigger a re-run.
  await repo.complete(updateId);
  return { processed: true, result };
}

export function fakeIdempotencyRepo(
  seed: string[] = [], opts: { now?: () => number } = {},
): IdempotencyRepo & { all(): string[] } {
  const now = opts.now ?? (() => Date.now());
  // Seeded ids stand for already-processed updates, so they start completed.
  const rows = new Map<string, { at: number; done: boolean }>(seed.map(id => [id, { at: now(), done: true }]));
  return {
    async claim(id) {
      const r = rows.get(id);
      if (r && (r.done || now() - r.at < CLAIM_STALE_MS)) return false;
      rows.set(id, { at: now(), done: false });
      return true;
    },
    async release(id) { rows.delete(id); },
    async complete(id) { const r = rows.get(id); if (r) r.done = true; },
    all() { return [...rows.keys()]; },
  };
}
