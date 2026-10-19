// src/db/cleanup-adapters.ts
import { and, asc, desc, eq, gte, or } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { ProposalRepo, ActionLogRepo, Proposal, ProposalStatus, ActionRun, ActionVerb, ActionLogEntry } from "../cleanup/proposals.js";

export function dbProposalRepo(): ProposalRepo {
  return {
    async create(userId, messageIds, summary): Promise<Proposal> {
      const [row] = await db().insert(schema.proposals)
        .values({ userId, messageIds, summary, status: "pending" }).returning();
      return { id: row!.id, userId, messageIds, summary, status: "pending" };
    },
    async get(userId, id): Promise<Proposal | null> {
      const [row] = await db().select().from(schema.proposals)
        .where(and(eq(schema.proposals.userId, userId), eq(schema.proposals.id, id))).limit(1);
      return row ? { id: row.id, userId, messageIds: row.messageIds, summary: row.summary, status: row.status as ProposalStatus } : null;
    },
    async markConfirmed(userId, id) {
      await db().update(schema.proposals).set({ status: "confirmed" })
        .where(and(eq(schema.proposals.userId, userId), eq(schema.proposals.id, id)));
    },
  };
}

export function dbActionLogRepo(): ActionLogRepo {
  return {
    async record(userId, runId, messageIds, action) {
      await db().insert(schema.actionLog).values({ userId, runId, messageIds, action, undone: false });
    },
    async lastUndoable(userId): Promise<ActionRun | null> {
      const [row] = await db().select().from(schema.actionLog)
        .where(and(eq(schema.actionLog.userId, userId), eq(schema.actionLog.undone, false)))
        .orderBy(desc(schema.actionLog.createdAt)).limit(1);
      return row ? { runId: row.runId, messageIds: row.messageIds, action: row.action as ActionVerb } : null;
    },
    async markUndone(userId, runId) {
      await db().update(schema.actionLog).set({ undone: true, undoneAt: new Date() })
        .where(and(eq(schema.actionLog.userId, userId), eq(schema.actionLog.runId, runId)));
    },
    async runsSince(userId, since): Promise<ActionLogEntry[]> {
      const rows = await db().select().from(schema.actionLog)
        .where(and(eq(schema.actionLog.userId, userId), or(gte(schema.actionLog.createdAt, since), gte(schema.actionLog.undoneAt, since))))
        .orderBy(asc(schema.actionLog.createdAt), asc(schema.actionLog.id));
      return rows.map(r => ({ runId: r.runId, messageIds: r.messageIds, action: r.action as ActionVerb, at: r.createdAt, undoneAt: r.undoneAt ?? null }));
    },
  };
}
