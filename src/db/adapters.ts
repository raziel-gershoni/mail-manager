// src/db/adapters.ts
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { MemoryStore, RuleMatch, MemoryIndexEntry, MemoryRow, Verdict } from "../memory/store.js";
import type { SeenRepo, SeenRow, SyncStateRepo } from "../notifier/sync.js";

// NOTE: dbMemoryStore loads the user's rows once (call per run). Writes go straight to the DB.
export async function dbMemoryStore(userId: number): Promise<MemoryStore> {
  const rows = await db().select().from(schema.memories).where(eq(schema.memories.userId, userId));
  const local: MemoryRow[] = rows.map(r => ({ userId, slug: r.slug, description: r.description, body: r.body,
    scope: r.scope, matchType: r.matchType, matchValue: r.matchValue, verdict: r.verdict }));
  return {
    findRuleFor(email, domain): RuleMatch | null {
      const s = local.find(r => r.matchType === "sender" && r.matchValue === email && r.verdict);
      const hit = s ?? local.find(r => r.matchType === "domain" && r.matchValue === domain && r.verdict);
      return hit ? { slug: hit.slug, verdict: hit.verdict as Verdict } : null;
    },
    index(): MemoryIndexEntry[] {
      return local.filter(r => r.matchType === null).map(r => ({ slug: r.slug, description: r.description, scope: r.scope }));
    },
    list() { return [...local]; },
    upsertSenderRule(email, verdict): MemoryRow {
      const slug = `sender:${email}`;
      const description = `sender ${email} is ${verdict}`;
      const row: MemoryRow = { userId, slug, description, body: "", scope: "sender", matchType: "sender", matchValue: email, verdict };
      const idx = local.findIndex(r => r.slug === slug);
      if (idx >= 0) local[idx] = row; else local.push(row);
      // fire-and-forget upsert
      void db().insert(schema.memories).values({ userId, slug, description, body: "", scope: "sender",
        matchType: "sender", matchValue: email, verdict, updatedAt: new Date() })
        .onConflictDoUpdate({ target: [schema.memories.userId, schema.memories.slug],
          set: { verdict, description, updatedAt: new Date() } });
      return row;
    },
  };
}

export function dbSeenRepo(): SeenRepo {
  return {
    async has(userId, messageId) {
      const r = await db().select().from(schema.seenMessages)
        .where(and(eq(schema.seenMessages.userId, userId), eq(schema.seenMessages.messageId, messageId))).limit(1);
      return r.length > 0;
    },
    async record(userId, row) {
      await db().insert(schema.seenMessages).values({ userId, messageId: row.messageId,
        surfaced: row.surfaced, verdict: row.verdict, reason: row.reason })
        .onConflictDoNothing({ target: [schema.seenMessages.userId, schema.seenMessages.messageId] });
    },
    async recentSuspicious(userId, limit) {
      const rows = await db().select().from(schema.seenMessages)
        .where(and(eq(schema.seenMessages.userId, userId), eq(schema.seenMessages.verdict, "suspicious"), eq(schema.seenMessages.surfaced, false)))
        .orderBy(desc(schema.seenMessages.createdAt)).limit(limit);
      return rows.map(r => ({ messageId: r.messageId, surfaced: r.surfaced, verdict: r.verdict, reason: r.reason }));
    },
    async get(userId, messageId) {
      const [r] = await db().select().from(schema.seenMessages)
        .where(and(eq(schema.seenMessages.userId, userId), eq(schema.seenMessages.messageId, messageId))).limit(1);
      return r ? { messageId: r.messageId, surfaced: r.surfaced, verdict: r.verdict, reason: r.reason } : null;
    },
  };
}

export function dbSyncRepo(): SyncStateRepo {
  return {
    async get(userId) {
      const [r] = await db().select().from(schema.syncState).where(eq(schema.syncState.userId, userId)).limit(1);
      return r?.lastHistoryId ?? null;
    },
    async set(userId, historyId) {
      await db().insert(schema.syncState).values({ userId, lastHistoryId: historyId })
        .onConflictDoUpdate({ target: schema.syncState.userId, set: { lastHistoryId: historyId, updatedAt: new Date() } });
    },
  };
}
