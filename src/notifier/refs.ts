// Couples a sent digest (its Telegram message id) to the EXACT Gmail messages it
// was about, so when the owner replies to that digest the bot resolves to precise
// message ids — no LLM guessing about which message "that one" means.

export interface DigestRef { id: string; from: string; subject: string; kind: string; } // kind: 'surfaced' | 'trashed' | 'archived'

export interface DigestRefRepo {
  save(userId: number, telegramMessageId: number, refs: DigestRef[]): Promise<void>;
  lookup(userId: number, telegramMessageId: number): Promise<DigestRef[] | null>;
}

// Build the ref list for one digest: the important messages it surfaced plus the
// messages it acted on (trashed/archived), each with its Gmail id.
export function buildDigestRefs(
  important: ReadonlyArray<{ messageId: string; from: string; subject: string }>,
  acted: ReadonlyArray<{ id: string; from: string; subject: string; action: string }>,
): DigestRef[] {
  return [
    ...important.map(i => ({ id: i.messageId, from: i.from, subject: i.subject, kind: "surfaced" })),
    ...acted.map(a => ({ id: a.id, from: a.from, subject: a.subject, kind: a.action })),
  ];
}

export function fakeDigestRefRepo(): DigestRefRepo {
  const rows = new Map<string, DigestRef[]>();
  const key = (u: number, m: number) => `${u}:${m}`;
  return {
    async save(userId, telegramMessageId, refs) { rows.set(key(userId, telegramMessageId), refs); },
    async lookup(userId, telegramMessageId) { return rows.get(key(userId, telegramMessageId)) ?? null; },
  };
}
