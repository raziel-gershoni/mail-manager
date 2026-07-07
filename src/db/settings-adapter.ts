// src/db/settings-adapter.ts
import { eq } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { SettingsRepo, UserSettingsRow } from "../settings/settings.js";

export function dbSettingsRepo(): SettingsRepo {
  return {
    async get(userId): Promise<UserSettingsRow | null> {
      const [r] = await db().select().from(schema.userSettings)
        .where(eq(schema.userSettings.userId, userId)).limit(1);
      return r ? { timezone: r.timezone, digestStartHour: r.digestStartHour, digestEndHour: r.digestEndHour, paused: r.paused, language: r.language } : null;
    },
    async upsert(userId, s: UserSettingsRow): Promise<void> {
      await db().insert(schema.userSettings)
        .values({ userId, timezone: s.timezone, digestStartHour: s.digestStartHour, digestEndHour: s.digestEndHour, paused: s.paused, language: s.language, updatedAt: new Date() })
        .onConflictDoUpdate({ target: schema.userSettings.userId,
          set: { timezone: s.timezone, digestStartHour: s.digestStartHour, digestEndHour: s.digestEndHour, paused: s.paused, language: s.language, updatedAt: new Date() } });
    },
  };
}
