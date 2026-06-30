// src/config/env.ts
export interface Env {
  DATABASE_URL: string; TOKEN_ENC_KEY: string;
  GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string; GOOGLE_REDIRECT_URI: string;
  GEMINI_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string; TELEGRAM_OWNER_ID: number; TELEGRAM_WEBHOOK_SECRET: string;
  QSTASH_TOKEN: string; QSTASH_CURRENT_SIGNING_KEY: string; QSTASH_NEXT_SIGNING_KEY: string;
  APP_BASE_URL: string;
}
const STRINGS = [
  "DATABASE_URL","TOKEN_ENC_KEY","GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REDIRECT_URI",
  "GEMINI_API_KEY","TELEGRAM_BOT_TOKEN","TELEGRAM_WEBHOOK_SECRET","QSTASH_TOKEN",
  "QSTASH_CURRENT_SIGNING_KEY","QSTASH_NEXT_SIGNING_KEY","APP_BASE_URL",
] as const;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const missing: string[] = [];
  const out: Record<string, unknown> = {};
  for (const key of STRINGS) {
    const v = source[key];
    if (!v) missing.push(key); else out[key] = v;
  }
  const owner = source.TELEGRAM_OWNER_ID;
  if (!owner) missing.push("TELEGRAM_OWNER_ID");
  else if (!/^\d+$/.test(owner)) throw new Error("TELEGRAM_OWNER_ID must be numeric");
  else out.TELEGRAM_OWNER_ID = Number(owner);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);
  return out as unknown as Env;
}

let cached: Env | null = null;
export function env(): Env { return (cached ??= loadEnv()); }
