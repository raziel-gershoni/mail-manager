// src/db/weekly-runs-adapter.ts
import { and, eq } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { WeeklyKind, WeeklyRunRepo } from "../weekly/runs.js";

export function dbWeeklyRunRepo(): WeeklyRunRepo {
  return {
    async get(userId, kind) {
      const [row] = await db().select({ week: schema.weeklyRuns.week }).from(schema.weeklyRuns)
        .where(and(eq(schema.weeklyRuns.userId, userId), eq(schema.weeklyRuns.kind, kind))).limit(1);
      return row ? row.week : null;
    },
    async set(userId: number, kind: WeeklyKind, week: string) {
      await db().insert(schema.weeklyRuns)
        .values({ userId, kind, week, at: new Date() })
        .onConflictDoUpdate({ target: [schema.weeklyRuns.userId, schema.weeklyRuns.kind], set: { week, at: new Date() } });
    },
  };
}
