// src/db/idempotency-adapter.ts
import { eq } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { IdempotencyRepo } from "../queue/idempotency.js";

export function dbIdempotencyRepo(): IdempotencyRepo {
  return {
    async claim(updateId) {
      const rows = await db().insert(schema.processedUpdates).values({ updateId })
        .onConflictDoNothing({ target: schema.processedUpdates.updateId })
        .returning({ updateId: schema.processedUpdates.updateId });
      return rows.length > 0;
    },
    async release(updateId) {
      await db().delete(schema.processedUpdates).where(eq(schema.processedUpdates.updateId, updateId));
    },
  };
}
