// The poll's activity log: a compact record of what each hourly cycle DID
// (auto-trashed/archived a message, or flagged a new un-ruled sender). It is
// written to a side table — NOT the conversation context — so the owner can pull
// it up on demand via the `recent_activity` tool ("what did you do?" / "what was
// that one?") without routine activity bloating the context. Trash/archive the
// owner asks for in chat are logged here too (source "chat"), and the weekly
// retrospect reads the last 7 days of it back.

// Why the bot acted: a plain sender rule (no body read), a guarded sender rule (body
// read and judged first), a standing preference (body read and judged first), or the
// owner asking in chat.
export type ActedSource = "guarded" | "plain" | "pref" | "chat";

// messageId/source are optional: rows logged before migration 0018 have neither, and a
// flagged sender has no message. The retrospect re-checks only items that carry an id.
export interface ActivityItem { action: string; from: string; subject: string; messageId?: string; source?: ActedSource; } // action: 'trashed' | 'archived' | 'flagged'
export interface ActivityRecord extends ActivityItem { at: Date; }

export interface ActivityRepo {
  record(userId: number, items: ActivityItem[]): Promise<void>;
  recent(userId: number, limit: number): Promise<ActivityRecord[]>; // newest first
  since(userId: number, since: Date): Promise<ActivityRecord[]>;    // at >= since, oldest first
}

// Build the log items for one cycle from the poll's outcome: each acted message
// (trashed/archived, with sender+subject, its Gmail id and why) plus each new un-ruled
// sender (flagged).
export function activityItemsFrom(
  acted: ReadonlyArray<{ id?: string; from: string; subject: string; action: string; source?: ActedSource }>,
  unruled: readonly string[],
): ActivityItem[] {
  return [
    ...acted.map((a) => ({ action: a.action, from: a.from, subject: a.subject, ...(a.id ? { messageId: a.id } : {}), ...(a.source ? { source: a.source } : {}) })),
    ...unruled.map((s) => ({ action: "flagged", from: s, subject: "" })),
  ];
}

// `clock` stamps each record (a test seam for since()'s date window). Without it the
// timestamps are synthetic and increasing, as before.
export function fakeActivityRepo(clock?: () => Date): ActivityRepo & { all(userId: number): ActivityRecord[] } {
  const rows: { userId: number; item: ActivityItem; seq: number; at: Date }[] = [];
  let seq = 0;
  const out = (r: { item: ActivityItem; at: Date }): ActivityRecord => ({ ...r.item, at: r.at });
  return {
    async record(userId, items) {
      for (const item of items) {
        const s = seq++;
        rows.push({ userId, item: { ...item }, seq: s, at: clock ? clock() : new Date(1_700_000_000_000 + s) });
      }
    },
    async recent(userId, limit) {
      return rows.filter(r => r.userId === userId).sort((a, b) => b.seq - a.seq).slice(0, limit).map(out);
    },
    async since(userId, since) {
      return rows.filter(r => r.userId === userId && r.at.getTime() >= since.getTime())
        .sort((a, b) => a.at.getTime() - b.at.getTime() || a.seq - b.seq).map(out);
    },
    all(userId) { return rows.filter(r => r.userId === userId).sort((a, b) => b.seq - a.seq).map(out); },
  };
}
