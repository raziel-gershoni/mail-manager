// src/db/google-account-adapter.ts
import { and, eq } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { GoogleAccountRepo } from "../oauth/reconnect.js";

export function dbGoogleAccountRepo(): GoogleAccountRepo {
  return {
    async markNeedsReconnect(userId) {
      // Atomic transition false→true: only rows currently false are updated, so a returned
      // row means we just transitioned (nudge once). Already-true rows update nothing.
      const rows = await db().update(schema.googleAccounts)
        .set({ needsReconnect: true, updatedAt: new Date() })
        .where(and(eq(schema.googleAccounts.userId, userId), eq(schema.googleAccounts.needsReconnect, false)))
        .returning({ id: schema.googleAccounts.id });
      return rows.length > 0;
    },
    async clearNeedsReconnect(userId) {
      await db().update(schema.googleAccounts).set({ needsReconnect: false, updatedAt: new Date() })
        .where(eq(schema.googleAccounts.userId, userId));
    },
    async updateRefreshToken(userId, encRefreshToken) {
      await db().update(schema.googleAccounts).set({ encRefreshToken, updatedAt: new Date() })
        .where(eq(schema.googleAccounts.userId, userId));
    },
    async getStatus(userId) {
      const [r] = await db().select({ email: schema.googleAccounts.email, needsReconnect: schema.googleAccounts.needsReconnect })
        .from(schema.googleAccounts).where(eq(schema.googleAccounts.userId, userId)).limit(1);
      return r ? { email: r.email, needsReconnect: r.needsReconnect } : null;
    },
  };
}
