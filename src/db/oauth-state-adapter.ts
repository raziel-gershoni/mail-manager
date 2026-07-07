// src/db/oauth-state-adapter.ts
import { eq } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { OAuthStateRepo } from "../oauth/reconnect.js";
import { isStateFresh } from "../oauth/reconnect.js";

export function dbOAuthStateRepo(): OAuthStateRepo {
  return {
    async create(state, userId, expiresAt) {
      await db().insert(schema.oauthStates).values({ state, userId, expiresAt: expiresAt ?? null });
    },
    async consume(state, now) {
      // Atomic one-time use: DELETE ... RETURNING, so only the caller that actually
      // removed the row receives it — a concurrent duplicate/replay gets no row (null).
      const [row] = await db().delete(schema.oauthStates)
        .where(eq(schema.oauthStates.state, state))
        .returning({ userId: schema.oauthStates.userId, createdAt: schema.oauthStates.createdAt, expiresAt: schema.oauthStates.expiresAt });
      if (!row) return null;
      const fresh = row.expiresAt ? now.getTime() < row.expiresAt.getTime() : isStateFresh(row.createdAt, now);
      return fresh ? row.userId : null;
    },
  };
}
