// Per-user settings shape + defaults resolution. Pure.
import { normalizeLang, type Lang } from "../i18n/index.js";

export interface UserSettingsRow {
  timezone: string | null;
  digestStartHour: number;
  digestEndHour: number;
  paused: boolean;
  language: string | null;   // null → "en"
}
export interface EffectiveSettings {
  timezone: string;
  digestStartHour: number;
  digestEndHour: number;
  paused: boolean;
  language: Lang;
}
export interface SettingsRepo {
  get(userId: number): Promise<UserSettingsRow | null>;
  upsert(userId: number, settings: UserSettingsRow): Promise<void>;
}

export function effectiveSettings(row: UserSettingsRow | null, defaultTz: string | undefined): EffectiveSettings {
  return {
    timezone: row?.timezone ?? defaultTz ?? "UTC",
    digestStartHour: row?.digestStartHour ?? 0,
    digestEndHour: row?.digestEndHour ?? 24,
    paused: row?.paused ?? false,
    language: normalizeLang(row?.language) ?? "en",
  };
}

export function fakeSettingsRepo(seed: Record<number, UserSettingsRow> = {}): SettingsRepo {
  const rows: Record<number, UserSettingsRow> = { ...seed };
  return {
    async get(userId) { return rows[userId] ?? null; },
    async upsert(userId, settings) { rows[userId] = settings; },
  };
}
