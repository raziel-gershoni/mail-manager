export type ProposalStatus = "pending" | "confirmed" | "expired";
export interface Proposal { id: number; userId: number; messageIds: string[]; summary: string; status: ProposalStatus; }
export interface ProposalRepo {
  create(userId: number, messageIds: string[], summary: string): Promise<Proposal>;
  get(userId: number, id: number): Promise<Proposal | null>;
  markConfirmed(userId: number, id: number): Promise<void>;
}
export interface ActionRun { runId: string; messageIds: string[]; }
export interface ActionLogRepo {
  record(userId: number, runId: string, messageIds: string[]): Promise<void>;
  lastUndoable(userId: number): Promise<ActionRun | null>;
  markUndone(userId: number, runId: string): Promise<void>;
}

export function fakeProposalRepo(): ProposalRepo {
  const rows: Proposal[] = [];
  let seq = 0;
  return {
    async create(userId, messageIds, summary) {
      const p: Proposal = { id: ++seq, userId, messageIds: [...messageIds], summary, status: "pending" };
      rows.push(p); return { ...p };
    },
    async get(userId, id) {
      const p = rows.find(r => r.userId === userId && r.id === id);
      return p ? { ...p } : null;
    },
    async markConfirmed(userId, id) {
      const p = rows.find(r => r.userId === userId && r.id === id);
      if (p) p.status = "confirmed";
    },
  };
}

export function fakeActionLogRepo(): ActionLogRepo {
  const rows: { userId: number; runId: string; messageIds: string[]; undone: boolean }[] = [];
  return {
    async record(userId, runId, messageIds) { rows.push({ userId, runId, messageIds: [...messageIds], undone: false }); },
    async lastUndoable(userId) {
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i]!;
        if (r.userId === userId && !r.undone) return { runId: r.runId, messageIds: [...r.messageIds] };
      }
      return null;
    },
    async markUndone(userId, runId) {
      const r = rows.find(x => x.userId === userId && x.runId === runId);
      if (r) r.undone = true;
    },
  };
}
