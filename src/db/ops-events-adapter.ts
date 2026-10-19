// src/db/ops-events-adapter.ts
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { OpsEvent, OpsEventKind, OpsEventRepo } from "../ops/events.js";

export function dbOpsEventRepo(): OpsEventRepo {
  return {
    async record(userId, kind, detail) {
      await db().insert(schema.opsEvents).values({ userId, kind, detail: detail ?? null });
    },
    async since(userId, since): Promise<OpsEvent[]> {
      const rows = await db().select().from(schema.opsEvents)
        .where(and(eq(schema.opsEvents.userId, userId), gte(schema.opsEvents.at, since)))
        .orderBy(asc(schema.opsEvents.at), asc(schema.opsEvents.id));
      return rows.map(r => ({ kind: r.kind as OpsEventKind, at: r.at, detail: r.detail ?? null }));
    },
    async prune(before) {
      await db().delete(schema.opsEvents).where(lt(schema.opsEvents.at, before));
    },
  };
}
