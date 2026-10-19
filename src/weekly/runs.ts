// src/weekly/runs.ts
// Which week each weekly job last REPORTED, per user. A job runs when the current week
// key differs from the stored one, and the key is written only after its report was
// sent — so a run that fails or never starts is retried the next hour, never skipped.

export type WeeklyKind = "spam" | "retro";

export interface WeeklyRunRepo {
  get(userId: number, kind: WeeklyKind): Promise<string | null>;
  set(userId: number, kind: WeeklyKind, week: string): Promise<void>;
}

export function fakeWeeklyRunRepo(): WeeklyRunRepo {
  const rows = new Map<string, string>();
  const key = (u: number, k: WeeklyKind) => `${u}:${k}`;
  return {
    async get(userId, kind) { return rows.get(key(userId, kind)) ?? null; },
    async set(userId, kind, week) { rows.set(key(userId, kind), week); },
  };
}
