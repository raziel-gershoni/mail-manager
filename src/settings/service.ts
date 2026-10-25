import type { EffectiveSettings, UserSettingsRow } from "./settings.js";
import type { MemoryRow } from "../memory/store.js";
import type { ContextUsage } from "../context/assemble.js";
import { t, type Lang } from "../i18n/index.js";
import { isValidSchedule, type WeekSchedule } from "./schedule.js";

export interface SettingsView extends EffectiveSettings {
  gmail: { email: string | null; connected: boolean; needsReconnect: boolean };
  rules: Array<{ matchValue: string; scope: string; verdict: string; action: string }>;
  context: ContextUsage;
}
export interface SettingsPatch { timezone?: string; paused?: boolean; language?: Lang; schedule?: WeekSchedule; }

// Keys the settings screen sent before the weekly schedule. An old screen left open
// across a deploy still sends them; rejecting the save makes it show "Save failed"
// instead of "Saved" for a change that would be dropped. Reopening loads the new screen.
const LEGACY_KEYS = ["digestStartHour", "digestEndHour", "activeDays"] as const;
export const LEGACY_PATCH_ERROR = "settings app updated — reopen it";

function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return true; } catch { return false; }
}
function isValidLanguage(v: unknown): v is Lang {
  return v === "en" || v === "he";
}

export function validateSettingsPatch(body: unknown): SettingsPatch | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "invalid body" };
  const p = body as Record<string, unknown>;
  if (LEGACY_KEYS.some(k => p[k] !== undefined)) return { error: LEGACY_PATCH_ERROR };
  const out: SettingsPatch = {};
  if (p.timezone !== undefined) { if (typeof p.timezone !== "string" || !isValidTimezone(p.timezone)) return { error: "invalid timezone" }; out.timezone = p.timezone; }
  if (p.paused !== undefined) { if (typeof p.paused !== "boolean") return { error: "invalid paused" }; out.paused = p.paused; }
  if (p.language !== undefined) { if (!isValidLanguage(p.language)) return { error: "invalid language" }; out.language = p.language; }
  if (p.schedule !== undefined) { if (!isValidSchedule(p.schedule)) return { error: "invalid schedule" }; out.schedule = p.schedule; }
  return out;
}

export function mergePatch(eff: EffectiveSettings, patch: SettingsPatch): UserSettingsRow {
  return {
    timezone: patch.timezone ?? eff.timezone,
    paused: patch.paused ?? eff.paused,
    language: patch.language ?? eff.language,
    schedule: patch.schedule ?? eff.schedule,
  };
}

// Storage keeps the terse action value ("review"); the settings UI shows a
// friendlier, localized label for the guarded actions.
function actionLabel(action: string | null, lang: Lang): string {
  if (action === "review") return t(lang, "action_guarded_trash");
  if (action === "review_archive") return t(lang, "action_guarded_archive");
  if (action === "keep") return t(lang, "action_keep");
  return action ?? "";
}

export function buildSettingsView(
  eff: EffectiveSettings,
  account: { email: string; needsReconnect: boolean } | null,
  rules: MemoryRow[],
  context: ContextUsage,
): SettingsView {
  return {
    ...eff,
    gmail: { email: account?.email ?? null, connected: account !== null, needsReconnect: account?.needsReconnect ?? false },
    rules: rules.filter(r => r.matchType !== null && r.matchValue !== null)
      .map(r => ({ matchValue: r.matchValue as string, scope: r.scope, verdict: r.verdict ?? "", action: actionLabel(r.action, eff.language) })),
    context,
  };
}
