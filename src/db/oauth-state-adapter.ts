// src/db/oauth-state-adapter.ts
import { eq } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { OAuthStateRepo } from "../oauth/reconnect.js";
import { isStateFresh } from "../oauth/reconnect.js";

export function dbOAuthStateRepo(): OAuthStateRepo {
  return {
    async create(state, userId) {
      await db().insert(schema.oauthStates).values({ state, userId });
    },
    async consume(state, now) {
      const [row] = await db().select().from(schema.oauthStates).where(eq(schema.oauthStates.state, state)).limit(1);
      await db().delete(schema.oauthStates).where(eq(schema.oauthStates.state, state)); // one-time use
      if (!row) return null;
      return isStateFresh(row.createdAt, now) ? row.userId : null;
    },
  };
}
