// Pure helpers + repo interfaces for token re-connect handling.
export const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

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

export function reconnectNudgeText(email?: string): string {
  return `⚠️ I lost access to your Gmail${email ? ` (${email})` : ""}. Please reconnect it to keep getting briefs.`;
}

export interface OAuthStateRepo {
  create(state: string, userId: number): Promise<void>;
  consume(state: string, now: Date): Promise<number | null>; // one-time: deletes the row; returns userId only if fresh
}

export interface GoogleAccountRepo {
  markNeedsReconnect(userId: number): Promise<boolean>;  // true iff it transitioned false→true (nudge only then)
  clearNeedsReconnect(userId: number): Promise<void>;
  updateRefreshToken(userId: number, encRefreshToken: string): Promise<void>;
  getStatus(userId: number): Promise<{ email: string; needsReconnect: boolean } | null>;
}

export function fakeOAuthStateRepo(): OAuthStateRepo & { create(state: string, userId: number, createdAt?: Date): Promise<void> } {
  const rows = new Map<string, { userId: number; createdAt: Date }>();
  return {
    async create(state: string, userId: number, createdAt: Date = new Date("2026-07-02T12:00:00Z")) { rows.set(state, { userId, createdAt }); },
    async consume(state, now) {
      const row = rows.get(state);
      rows.delete(state);                            // one-time use, deleted regardless of freshness
      if (!row) return null;
      return isStateFresh(row.createdAt, now) ? row.userId : null;
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
