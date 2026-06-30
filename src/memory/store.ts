export type Verdict = "important" | "unimportant";
export interface RuleMatch { slug: string; verdict: Verdict; }
export interface MemoryIndexEntry { slug: string; description: string; scope: string; }
export interface MemoryRow {
  userId: number; slug: string; description: string; body: string;
  scope: string; matchType: string | null; matchValue: string | null; verdict: string | null;
}
export interface MemoryStore {
  findRuleFor(fromEmail: string, fromDomain: string): RuleMatch | null;
  index(): MemoryIndexEntry[];
  list(): MemoryRow[];
  upsertSenderRule(fromEmail: string, verdict: Verdict): MemoryRow;
}

export function inMemoryStore(seed: MemoryRow[] = []): MemoryStore {
  const rows: MemoryRow[] = [...seed];
  return {
    findRuleFor(fromEmail, fromDomain) {
      const sender = rows.find(r => r.matchType === "sender" && r.matchValue === fromEmail && r.verdict);
      const hit = sender ?? rows.find(r => r.matchType === "domain" && r.matchValue === fromDomain && r.verdict);
      return hit ? { slug: hit.slug, verdict: hit.verdict as Verdict } : null;
    },
    index() {
      return rows.filter(r => r.matchType === null).map(r => ({ slug: r.slug, description: r.description, scope: r.scope }));
    },
    list() { return [...rows]; },
    upsertSenderRule(fromEmail, verdict) {
      const slug = `sender:${fromEmail}`;
      let row = rows.find(r => r.slug === slug);
      if (!row) {
        row = { userId: 1, slug, description: `sender ${fromEmail} is ${verdict}`,
          body: "", scope: "sender", matchType: "sender", matchValue: fromEmail, verdict };
        rows.push(row);
      } else { row.verdict = verdict; row.description = `sender ${fromEmail} is ${verdict}`; }
      return row;
    },
  };
}
