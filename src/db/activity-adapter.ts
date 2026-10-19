// src/db/activity-adapter.ts
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { ActivityRepo, ActivityRecord, ActedSource } from "../notifier/activity.js";

function toRecord(r: typeof schema.pollActivity.$inferSelect): ActivityRecord {
  return { action: r.action, from: r.fromAddr, subject: r.subject, at: r.createdAt,
    ...(r.messageId ? { messageId: r.messageId } : {}), ...(r.source ? { source: r.source as ActedSource } : {}) };
}

export function dbActivityRepo(): ActivityRepo {
  return {
    async record(userId, items) {
      if (items.length === 0) return;
      await db().insert(schema.pollActivity)
        .values(items.map(i => ({ userId, action: i.action, fromAddr: i.from, subject: i.subject, messageId: i.messageId ?? null, source: i.source ?? null })));
    },
    async recent(userId, limit) {
      const rows = await db().select().from(schema.pollActivity)
        .where(eq(schema.pollActivity.userId, userId))
        .orderBy(desc(schema.pollActivity.createdAt), desc(schema.pollActivity.id))
        .limit(limit);
      return rows.map(toRecord);
    },
    async since(userId, since) {
      const rows = await db().select().from(schema.pollActivity)
        .where(and(eq(schema.pollActivity.userId, userId), gte(schema.pollActivity.createdAt, since)))
        .orderBy(asc(schema.pollActivity.createdAt), asc(schema.pollActivity.id));
      return rows.map(toRecord);
    },
  };
}
