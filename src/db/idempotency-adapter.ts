// src/db/idempotency-adapter.ts
import { eq, sql } from "drizzle-orm";
import { db, schema } from "./client.js";
import { CLAIM_STALE_MS, type IdempotencyRepo } from "../queue/idempotency.js";

export function dbIdempotencyRepo(): IdempotencyRepo {
  return {
    // One atomic statement, so two concurrent deliveries can never both win.
    //
    // Insert if the update is new. On conflict, take the claim over ONLY when the
    // row is unfinished AND its claim predates anything that could still be running
    // (see CLAIM_STALE_MS). A completed row never matches, so a late duplicate is
    // always rejected. RETURNING yields a row only when we actually inserted or
    // updated — which is exactly "did we win the claim".
    //
    // The staleness comparison uses the DATABASE's now(), not the app's, so clock
    // skew between serverless instances cannot make a live claim look dead.
    async claim(updateId) {
      const rows = await db().insert(schema.processedUpdates).values({ updateId })
        .onConflictDoUpdate({
          target: schema.processedUpdates.updateId,
          set: { createdAt: sql`now()` },
          setWhere: sql`${schema.processedUpdates.completedAt} is null and ${schema.processedUpdates.createdAt} < now() - ${CLAIM_STALE_MS} * interval '1 millisecond'`,
        })
        .returning({ updateId: schema.processedUpdates.updateId });
      return rows.length > 0;
    },
    async release(updateId) {
      await db().delete(schema.processedUpdates).where(eq(schema.processedUpdates.updateId, updateId));
    },
    async complete(updateId) {
      await db().update(schema.processedUpdates).set({ completedAt: sql`now()` })
        .where(eq(schema.processedUpdates.updateId, updateId));
    },
  };
}
