// Pure helpers + repo interfaces for token re-connect handling.
import { t, type Lang } from "../i18n/index.js";

export const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
// Provisioning consent links are sent out-of-band to a second user, so they get a
// longer window than the reconnect flow's implicit 15-min createdAt TTL.
export const PROVISION_STATE_TTL_MS = 60 * 60 * 1000;

export function isInvalidGrant(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { message?: unknown; code?: unknown; response?: { data?: { error?: unknown } } };
  if (e.code === "invalid_grant") return true;
  if (e.response?.data?.error === "invalid_grant") return true;
  return typeof e.message === "string" && /invalid_grant/i.test(e.message);
}

export function isStateFresh(createdAt: Date, now: Date, ttlMs: number = OAUTH_STATE_TTL_MS): boolean {
  return now.getTime() - createdAt.getTime() < ttlMs;
}

export function reconnectNudgeText(email?: string, lang: Lang = "en"): string {
  return t(lang, "reconnect_nudge", { email: email ? ` (${email})` : "" });
}

export interface OAuthStateRepo {
  // `expiresAt` (when set) is an absolute expiry; when omitted, freshness falls back
  // to the implicit createdAt + OAUTH_STATE_TTL_MS (the reconnect flow).
  create(state: string, userId: number, expiresAt?: Date): Promise<void>;
  consume(state: string, now: Date): Promise<number | null>; // one-time: deletes the row; returns userId only if fresh
}

export interface GoogleAccountRepo {
  markNeedsReconnect(userId: number): Promise<boolean>;  // true iff it transitioned false→true (nudge only then)
  clearNeedsReconnect(userId: number): Promise<void>;
  updateRefreshToken(userId: number, encRefreshToken: string): Promise<void>;
  getStatus(userId: number): Promise<{ email: string; needsReconnect: boolean } | null>;
}

export function fakeOAuthStateRepo(): OAuthStateRepo & { create(state: string, userId: number, expiresAt?: Date, createdAt?: Date): Promise<void> } {
  const rows = new Map<string, { userId: number; createdAt: Date; expiresAt?: Date }>();
  return {
    async create(state: string, userId: number, expiresAt?: Date, createdAt: Date = new Date("2026-07-02T12:00:00Z")) { rows.set(state, { userId, createdAt, expiresAt }); },
    async consume(state, now) {
      const row = rows.get(state);
      rows.delete(state);                            // one-time use, deleted regardless of freshness
      if (!row) return null;
      const fresh = row.expiresAt ? now.getTime() < row.expiresAt.getTime() : isStateFresh(row.createdAt, now);
      return fresh ? row.userId : null;
    },
  };
}

export function fakeGoogleAccountRepo(seed: Record<number, boolean> = {}, emails: Record<number, string> = {}): GoogleAccountRepo & { flag(userId: number): boolean } {
  const needs: Record<number, boolean> = { ...seed };
  return {
    async markNeedsReconnect(userId) { if (needs[userId]) return false; needs[userId] = true; return true; },
    async clearNeedsReconnect(userId) { needs[userId] = false; },
    async updateRefreshToken() { /* no-op in fake */ },
    async getStatus(userId) { return userId in needs ? { email: emails[userId] ?? "a@b.com", needsReconnect: needs[userId]! } : null; },
    flag(userId) { return needs[userId] ?? false; },
  };
}
