// src/db/settings-adapter.ts
import { eq } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { SettingsRepo, UserSettingsRow } from "../settings/settings.js";
import { ALWAYS_ON, isValidSchedule, type WeekSchedule } from "../settings/schedule.js";
import { log } from "../util/log.js";

// A stored schedule the app can't read (hand-edited, or written by a bug) falls back to
// every day all day: briefs keep arriving, visibly, instead of the hourly check failing.
export function readStoredSchedule(raw: unknown, userId: number): WeekSchedule {
  if (isValidSchedule(raw)) return raw;
  log("settings.bad_schedule", { userId, value: JSON.stringify(raw)?.slice(0, 200) });
  return ALWAYS_ON;
}

export function dbSettingsRepo(): SettingsRepo {
  return {
    async get(userId): Promise<UserSettingsRow | null> {
      const [r] = await db().select().from(schema.userSettings)
        .where(eq(schema.userSettings.userId, userId)).limit(1);
      return r ? { timezone: r.timezone, paused: r.paused, language: r.language, schedule: readStoredSchedule(r.schedule, userId) } : null;
    },
    async upsert(userId, s: UserSettingsRow): Promise<void> {
      const row = { timezone: s.timezone, paused: s.paused, language: s.language, schedule: s.schedule, updatedAt: new Date() };
      await db().insert(schema.userSettings)
        .values({ userId, ...row })
        .onConflictDoUpdate({ target: schema.userSettings.userId, set: row });
    },
  };
}
