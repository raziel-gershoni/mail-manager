// src/db/cleanup-adapters.ts
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { ProposalRepo, ActionLogRepo, Proposal, ProposalStatus, ActionRun } from "../cleanup/proposals.js";

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
    async record(userId, runId, messageIds) {
      await db().insert(schema.actionLog).values({ userId, runId, messageIds, undone: false });
    },
    async lastUndoable(userId): Promise<ActionRun | null> {
      const [row] = await db().select().from(schema.actionLog)
        .where(and(eq(schema.actionLog.userId, userId), eq(schema.actionLog.undone, false)))
        .orderBy(desc(schema.actionLog.createdAt)).limit(1);
      return row ? { runId: row.runId, messageIds: row.messageIds } : null;
    },
    async markUndone(userId, runId) {
      await db().update(schema.actionLog).set({ undone: true })
        .where(and(eq(schema.actionLog.userId, userId), eq(schema.actionLog.runId, runId)));
    },
  };
}
