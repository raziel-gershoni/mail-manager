// src/i18n/index.ts — tiny i18n runtime over the hand-rolled message tables.
import { messages, type MsgKey } from "./messages.js";

export type { MsgKey };
export type Lang = "en" | "he";

export function dir(lang: Lang): "ltr" | "rtl" {
  return lang === "he" ? "rtl" : "ltr";
}

export function normalizeLang(v: unknown): Lang | undefined {
  return v === "en" || v === "he" ? v : undefined;
}

// Total lookup: falls back to the en string if a key is somehow absent, then
// interpolates {name} placeholders from params.
export function t(lang: Lang, key: MsgKey, params?: Record<string, string | number>): string {
  let s = (messages[lang] ?? messages.en)[key] ?? messages.en[key];
  if (params) for (const [k, val] of Object.entries(params)) s = s.split(`{${k}}`).join(String(val));
  return s;
}
