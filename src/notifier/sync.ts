export interface SyncStateRepo {
  get(userId: number): Promise<string | null>;
  set(userId: number, historyId: string): Promise<void>;
}

export interface SeenRow {
  messageId: string;
  surfaced: boolean;
  verdict: string;
  reason: string;
}

export interface SeenRepo {
  has(userId: number, messageId: string): Promise<boolean>;
  record(userId: number, row: SeenRow): Promise<void>;
  recentSuspicious(userId: number, limit: number): Promise<SeenRow[]>;
  get(userId: number, messageId: string): Promise<SeenRow | null>;
}

export function fakeSyncRepo(): SyncStateRepo {
  const m = new Map<number, string>();
  return {
    async get(u) {
      return m.get(u) ?? null;
    },
    async set(u, h) {
      m.set(u, h);
    },
  };
}

export function fakeSeenRepo(): SeenRepo {
  const m = new Map<string, SeenRow>();
  const k = (u: number, id: string) => `${u}:${id}`;
  const order: { u: number; id: string }[] = [];
  return {
    async has(u, id) {
      return m.has(k(u, id));
    },
    async record(u, row) {
      if (!m.has(k(u, row.messageId))) order.push({ u, id: row.messageId });
      m.set(k(u, row.messageId), row);
    },
    async recentSuspicious(u, limit) {
      if (limit <= 0) return [];
      return order
        .filter(o => o.u === u)
        .map(o => m.get(k(o.u, o.id))!)
        .filter(r => r.verdict === "suspicious" && !r.surfaced)
        .slice(-limit)
        .reverse();
    },
    async get(u, id) {
      return m.get(k(u, id)) ?? null;
    },
  };
}
