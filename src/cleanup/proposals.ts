export type ProposalStatus = "pending" | "confirmed" | "expired";
export interface Proposal { id: number; userId: number; messageIds: string[]; summary: string; status: ProposalStatus; }
export interface ProposalRepo {
  create(userId: number, messageIds: string[], summary: string): Promise<Proposal>;
  get(userId: number, id: number): Promise<Proposal | null>;
  markConfirmed(userId: number, id: number): Promise<void>;
}
// What a logged run did, so undo_last knows how to reverse it: trash ↔ untrash,
// archive ↔ unarchive, unspam (a rescue out of Spam) ↔ respam.
export type ActionVerb = "trash" | "archive" | "unspam";
export interface ActionRun { runId: string; messageIds: string[]; action: ActionVerb; }
export interface ActionLogRepo {
  record(userId: number, runId: string, messageIds: string[], action: ActionVerb): Promise<void>;
  lastUndoable(userId: number): Promise<ActionRun | null>;
  markUndone(userId: number, runId: string): Promise<void>; // also stamps when (undone_at)
}

export function fakeProposalRepo(): ProposalRepo {
  const rows: Proposal[] = [];
  let seq = 0;
  return {
    async create(userId, messageIds, summary) {
      const p: Proposal = { id: ++seq, userId, messageIds: [...messageIds], summary, status: "pending" };
      rows.push(p); return { ...p, messageIds: [...p.messageIds] };
    },
    async get(userId, id) {
      const p = rows.find(r => r.userId === userId && r.id === id);
      return p ? { ...p, messageIds: [...p.messageIds] } : null;
    },
    async markConfirmed(userId, id) {
      const p = rows.find(r => r.userId === userId && r.id === id);
      if (p) p.status = "confirmed";
    },
  };
}

// `now` is a test seam for the timestamps; `undoneAt` is test-only introspection.
export function fakeActionLogRepo(now: () => Date = () => new Date()): ActionLogRepo & { undoneAt(userId: number, runId: string): Date | null } {
  const rows: { userId: number; runId: string; messageIds: string[]; action: ActionVerb; undone: boolean; at: Date; undoneAt: Date | null }[] = [];
  return {
    async record(userId, runId, messageIds, action) { rows.push({ userId, runId, messageIds: [...messageIds], action, undone: false, at: now(), undoneAt: null }); },
    async lastUndoable(userId) {
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i]!;
        if (r.userId === userId && !r.undone) return { runId: r.runId, messageIds: [...r.messageIds], action: r.action };
      }
      return null;
    },
    async markUndone(userId, runId) {
      const r = rows.find(x => x.userId === userId && x.runId === runId);
      if (r) { r.undone = true; r.undoneAt = now(); }
    },
    undoneAt(userId, runId) { return rows.find(x => x.userId === userId && x.runId === runId)?.undoneAt ?? null; },
  };
}
