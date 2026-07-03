// src/queue/idempotency.ts
export interface IdempotencyRepo {
  claim(updateId: string): Promise<boolean>; // true iff newly claimed (first time)
  release(updateId: string): Promise<void>;
}

// Run fn at most once per updateId. A duplicate returns { processed: false } without running fn.
// On fn error, release the claim so a retry can re-process, then rethrow.
export async function withIdempotency<T>(
  updateId: string, repo: IdempotencyRepo, fn: () => Promise<T>,
): Promise<{ processed: true; result: T } | { processed: false }> {
  const claimed = await repo.claim(updateId);
  if (!claimed) return { processed: false };
  try {
    return { processed: true, result: await fn() };
  } catch (e) {
    await repo.release(updateId);
    throw e;
  }
}

export function fakeIdempotencyRepo(seed: string[] = []): IdempotencyRepo & { all(): string[] } {
  const seen = new Set<string>(seed);
  return {
    async claim(id) { if (seen.has(id)) return false; seen.add(id); return true; },
    async release(id) { seen.delete(id); },
    all() { return [...seen]; },
  };
}
