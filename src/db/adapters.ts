// src/db/adapters.ts
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "./client.js";
import { matchRuleIn, keyFromSlug } from "../memory/store.js";
import type { MemoryStore, RuleMatch, MemoryIndexEntry, MemoryRow, Verdict } from "../memory/store.js";
import type { SeenRepo, SeenRow, SyncStateRepo } from "../notifier/sync.js";

// NOTE: dbMemoryStore loads the user's rows once (call per run). Writes go straight to the DB.
export async function dbMemoryStore(userId: number): Promise<MemoryStore & { flush(): Promise<void> }> {
  const rows = await db().select().from(schema.memories).where(eq(schema.memories.userId, userId));
  const local: MemoryRow[] = rows.map(r => ({ userId, slug: r.slug, description: r.description, body: r.body,
    scope: r.scope, matchType: r.matchType, matchValue: r.matchValue, verdict: r.verdict, action: r.action, pending: r.pending }));
  const pending: Promise<unknown>[] = [];
  return {
    findRuleFor(email, domain): RuleMatch | null {
      return matchRuleIn(local, email, domain);
    },
    index(): MemoryIndexEntry[] {
      return local.filter(r => r.matchType === null && !r.pending)
        .map(r => ({ slug: r.slug, key: keyFromSlug(r.slug), description: r.description, scope: r.scope, verdict: r.verdict, action: r.action }));
    },
    list() { return [...local]; },
    upsertSenderRule(email, verdict): MemoryRow {
      const value = email.toLowerCase();
      const slug = `sender:${value}`;
      const description = `sender ${value} is ${verdict}`;
      const existing = local.find(r => r.slug === slug);
      const row: MemoryRow = { userId, slug, description, body: "", scope: "sender", matchType: "sender", matchValue: value, verdict, action: existing?.action ?? null };
      const idx = local.findIndex(r => r.slug === slug);
      if (idx >= 0) local[idx] = row; else local.push(row);
      // Importance-only upsert: omit `action` from the update set so an existing
      // learned cleanup action is never clobbered by a plain importance rule.
      const writePromise = db().insert(schema.memories).values({ userId, slug, description, body: "", scope: "sender",
        matchType: "sender", matchValue: value, verdict, updatedAt: new Date() })
        .onConflictDoUpdate({ target: [schema.memories.userId, schema.memories.slug],
          set: { verdict, description, updatedAt: new Date() } });
      // Queue the ORIGINAL promise so flush() can observe a rejection. The no-op
      // catch is attached to a SEPARATE reference purely to suppress Node's
      // unhandled-rejection warning; it does not swallow the rejection flush() sees.
      pending.push(writePromise);
      writePromise.catch(() => {});
      return row;
    },
    upsertRule({ matchValue, scope, verdict, description, action }): MemoryRow {
      const value = matchValue.toLowerCase();
      const slug = `${scope}:${value}`;
      const existing = local.find(r => r.slug === slug);
      const row: MemoryRow = { userId, slug, description, body: "", scope, matchType: scope, matchValue: value, verdict, action: action ?? existing?.action ?? null };
      const idx = local.findIndex(r => r.slug === slug);
      if (idx >= 0) local[idx] = row; else local.push(row);
      const writePromise = db().insert(schema.memories).values({ userId, slug, description, body: "", scope,
        matchType: scope, matchValue: value, verdict, action: action ?? existing?.action ?? null, updatedAt: new Date() })
        .onConflictDoUpdate({ target: [schema.memories.userId, schema.memories.slug],
          set: { verdict, description, action: action ?? existing?.action ?? null, updatedAt: new Date() } });
      pending.push(writePromise);
      writePromise.catch(() => {});
      return row;
    },
    upsertPreference({ key, description, verdict, action }): MemoryRow {
      const slug = `global:${key}`;
      const row: MemoryRow = { userId, slug, description, body: "", scope: "global", matchType: null, matchValue: null, verdict, action: action ?? null, pending: true };
      const idx = local.findIndex(r => r.slug === slug);
      if (idx >= 0) local[idx] = row; else local.push(row);
      const writePromise = db().insert(schema.memories).values({ userId, slug, description, body: "", scope: "global",
        matchType: null, matchValue: null, verdict, action: action ?? null, pending: true, updatedAt: new Date() })
        .onConflictDoUpdate({ target: [schema.memories.userId, schema.memories.slug],
          set: { description, verdict, action: action ?? null, pending: true, updatedAt: new Date() } });
      pending.push(writePromise);
      writePromise.catch(() => {});
      return row;
    },
    confirmPreference(key: string): MemoryRow | null {
      const slug = `global:${key}`;
      const row = local.find(r => r.slug === slug);
      if (!row) return null;
      row.pending = false;
      const writePromise = db().update(schema.memories).set({ pending: false, updatedAt: new Date() })
        .where(and(eq(schema.memories.userId, userId), eq(schema.memories.slug, slug)));
      pending.push(writePromise);
      writePromise.catch(() => {});
      return row;
    },
    deleteBySlug(slug: string): void {
      const idx = local.findIndex(r => r.slug === slug);
      if (idx >= 0) local.splice(idx, 1);
      const deletePromise = db().delete(schema.memories)
        .where(and(eq(schema.memories.userId, userId), eq(schema.memories.slug, slug)));
      pending.push(deletePromise);
      deletePromise.catch(() => {});
    },
    async flush(): Promise<void> {
      const results = await Promise.allSettled(pending);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      for (const r of rejected) console.error("memory upsert failed", r.reason);
      if (rejected.length > 0) {
        throw new Error(`${rejected.length} learned-rule write(s) failed`);
      }
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
