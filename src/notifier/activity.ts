// The poll's activity log: a compact record of what each ~30-min cycle DID
// (auto-trashed/archived a message, or flagged a new un-ruled sender). It is
// written to a side table — NOT the conversation context — so the owner can pull
// it up on demand via the `recent_activity` tool ("what did you do?" / "what was
// that one?") without routine activity bloating the context.

export interface ActivityItem { action: string; from: string; subject: string; } // action: 'trashed' | 'archived' | 'flagged'
export interface ActivityRecord extends ActivityItem { at: Date; }

export interface ActivityRepo {
  record(userId: number, items: ActivityItem[]): Promise<void>;
  recent(userId: number, limit: number): Promise<ActivityRecord[]>; // newest first
}

// Build the log items for one cycle from the poll's outcome: each acted message
// (trashed/archived, with sender+subject) plus each new un-ruled sender (flagged).
export function activityItemsFrom(
  acted: ReadonlyArray<{ from: string; subject: string; action: string }>,
  unruled: readonly string[],
): ActivityItem[] {
  return [
    ...acted.map((a) => ({ action: a.action, from: a.from, subject: a.subject })),
    ...unruled.map((s) => ({ action: "flagged", from: s, subject: "" })),
  ];
}

export function fakeActivityRepo(): ActivityRepo & { all(userId: number): ActivityRecord[] } {
  const rows: { userId: number; item: ActivityItem; seq: number }[] = [];
  let seq = 0;
  return {
    async record(userId, items) { for (const item of items) rows.push({ userId, item, seq: seq++ }); },
    async recent(userId, limit) {
      return rows.filter(r => r.userId === userId).sort((a, b) => b.seq - a.seq).slice(0, limit)
        .map(r => ({ ...r.item, at: new Date(1_700_000_000_000 + r.seq) }));
    },
    all(userId) { return rows.filter(r => r.userId === userId).sort((a, b) => b.seq - a.seq).map(r => ({ ...r.item, at: new Date(1_700_000_000_000 + r.seq) })); },
  };
}
