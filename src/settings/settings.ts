// Per-user settings shape + defaults resolution. Pure.
import { normalizeLang, type Lang } from "../i18n/index.js";
import { ALWAYS_ON, type WeekSchedule } from "./schedule.js";

export interface UserSettingsRow {
  timezone: string | null;
  paused: boolean;
  language: string | null;   // null → "en"
  schedule: WeekSchedule;
}
export interface EffectiveSettings {
  timezone: string;
  paused: boolean;
  language: Lang;
  schedule: WeekSchedule;
}
export interface SettingsRepo {
  get(userId: number): Promise<UserSettingsRow | null>;
  upsert(userId: number, settings: UserSettingsRow): Promise<void>;
}

export function effectiveSettings(row: UserSettingsRow | null, defaultTz: string | undefined): EffectiveSettings {
  return {
    timezone: row?.timezone ?? defaultTz ?? "UTC",
    paused: row?.paused ?? false,
    language: normalizeLang(row?.language) ?? "en",
    schedule: row?.schedule ?? ALWAYS_ON,
  };
}

export function fakeSettingsRepo(seed: Record<number, UserSettingsRow> = {}): SettingsRepo {
  const rows: Record<number, UserSettingsRow> = { ...seed };
  return {
    async get(userId) { return rows[userId] ?? null; },
    async upsert(userId, settings) { rows[userId] = settings; },
  };
}
