import type { EffectiveSettings, UserSettingsRow } from "./settings.js";
import type { MemoryRow } from "../memory/store.js";
import type { ContextUsage } from "../context/assemble.js";
import { t, type Lang } from "../i18n/index.js";

export interface SettingsView extends EffectiveSettings {
  gmail: { email: string | null; connected: boolean; needsReconnect: boolean };
  rules: Array<{ matchValue: string; scope: string; verdict: string; action: string }>;
  context: ContextUsage;
}
export interface SettingsPatch { timezone?: string; digestStartHour?: number; digestEndHour?: number; paused?: boolean; language?: Lang; }

function isHour(v: unknown, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
}
function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return true; } catch { return false; }
}
function isValidLanguage(v: unknown): v is Lang {
  return v === "en" || v === "he";
}

export function validateSettingsPatch(body: unknown): SettingsPatch | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "invalid body" };
  const p = body as Record<string, unknown>;
  const out: SettingsPatch = {};
  if (p.timezone !== undefined) { if (typeof p.timezone !== "string" || !isValidTimezone(p.timezone)) return { error: "invalid timezone" }; out.timezone = p.timezone; }
  if (p.digestStartHour !== undefined) { if (!isHour(p.digestStartHour, 23)) return { error: "invalid digestStartHour" }; out.digestStartHour = p.digestStartHour; }
  if (p.digestEndHour !== undefined) { if (!isHour(p.digestEndHour, 24)) return { error: "invalid digestEndHour" }; out.digestEndHour = p.digestEndHour; }
  if (p.paused !== undefined) { if (typeof p.paused !== "boolean") return { error: "invalid paused" }; out.paused = p.paused; }
  if (p.language !== undefined) { if (!isValidLanguage(p.language)) return { error: "invalid language" }; out.language = p.language; }
  return out;
}

export function mergePatch(eff: EffectiveSettings, patch: SettingsPatch): UserSettingsRow {
  return {
    timezone: patch.timezone ?? eff.timezone,
    digestStartHour: patch.digestStartHour ?? eff.digestStartHour,
    digestEndHour: patch.digestEndHour ?? eff.digestEndHour,
    paused: patch.paused ?? eff.paused,
    language: patch.language ?? eff.language,
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
