// src/db/refs-adapter.ts
import { and, eq } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { DigestRef, DigestRefRepo } from "../notifier/refs.js";

export function dbDigestRefRepo(): DigestRefRepo {
  return {
    async save(userId, telegramMessageId, refs) {
      await db().insert(schema.messageRefs)
        .values({ userId, telegramMessageId, refs })
        .onConflictDoUpdate({ target: [schema.messageRefs.userId, schema.messageRefs.telegramMessageId], set: { refs } });
    },
    async lookup(userId, telegramMessageId): Promise<DigestRef[] | null> {
      const [row] = await db().select({ refs: schema.messageRefs.refs }).from(schema.messageRefs)
        .where(and(eq(schema.messageRefs.userId, userId), eq(schema.messageRefs.telegramMessageId, telegramMessageId)))
        .limit(1);
      return row ? row.refs : null;
    },
  };
}
