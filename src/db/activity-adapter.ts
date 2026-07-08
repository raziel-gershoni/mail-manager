// src/db/activity-adapter.ts
import { eq, desc } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { ActivityRepo } from "../notifier/activity.js";

export function dbActivityRepo(): ActivityRepo {
  return {
    async record(userId, items) {
      if (items.length === 0) return;
      await db().insert(schema.pollActivity)
        .values(items.map(i => ({ userId, action: i.action, fromAddr: i.from, subject: i.subject })));
    },
    async recent(userId, limit) {
      const rows = await db().select().from(schema.pollActivity)
        .where(eq(schema.pollActivity.userId, userId))
        .orderBy(desc(schema.pollActivity.createdAt), desc(schema.pollActivity.id))
        .limit(limit);
      return rows.map(r => ({ action: r.action, from: r.fromAddr, subject: r.subject, at: r.createdAt }));
    },
  };
}
