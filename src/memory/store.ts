export type Verdict = "important" | "unimportant";
export interface RuleMatch { slug: string; verdict: Verdict; action: "trash" | "archive" | null; }
export interface MemoryIndexEntry { slug: string; description: string; scope: string; }
export interface MemoryRow {
  userId: number; slug: string; description: string; body: string;
  scope: string; matchType: string | null; matchValue: string | null; verdict: string | null;
  action: string | null;
}
export interface MemoryStore {
  findRuleFor(fromEmail: string, fromDomain: string): RuleMatch | null;
  index(): MemoryIndexEntry[];
  list(): MemoryRow[];
  upsertSenderRule(fromEmail: string, verdict: Verdict): MemoryRow;
  upsertRule(input: { matchValue: string; scope: "sender" | "domain"; verdict: Verdict; description: string; action?: "trash" | "archive" }): MemoryRow;
  deleteBySlug(slug: string): void;
}

// Rule matching is case-insensitive: incoming from-addresses are already
// lowercased (parseMessage), but a stored matchValue may be mixed-case (e.g. an
// LLM-typed "Dalymail@..."), so normalize both sides or such a rule silently
// never fires. Existing DB rows are covered here without a migration.
export function matchRuleIn(rows: MemoryRow[], fromEmail: string, fromDomain: string): RuleMatch | null {
  const email = fromEmail.toLowerCase();
  const domain = fromDomain.toLowerCase();
  const sender = rows.find(r => r.matchType === "sender" && r.matchValue?.toLowerCase() === email && r.verdict);
  const hit = sender ?? rows.find(r => r.matchType === "domain" && r.matchValue?.toLowerCase() === domain && r.verdict);
  return hit ? { slug: hit.slug, verdict: hit.verdict as Verdict, action: (hit.action as "trash" | "archive" | null) ?? null } : null;
}

export function inMemoryStore(seed: MemoryRow[] = [], userId = 1): MemoryStore {
  const rows: MemoryRow[] = [...seed];
  return {
    findRuleFor(fromEmail, fromDomain) {
      return matchRuleIn(rows, fromEmail, fromDomain);
    },
    index() {
      return rows.filter(r => r.matchType === null).map(r => ({ slug: r.slug, description: r.description, scope: r.scope }));
    },
    list() { return [...rows]; },
    upsertSenderRule(fromEmail, verdict) {
      const email = fromEmail.toLowerCase();
      const slug = `sender:${email}`;
      const description = `sender ${email} is ${verdict}`;
      let row = rows.find(r => r.slug === slug);
      if (!row) {
        row = { userId, slug, description, body: "", scope: "sender", matchType: "sender", matchValue: email, verdict, action: null };
        rows.push(row);
      } else { row.verdict = verdict; row.description = description; }
      return row;
    },
    upsertRule({ matchValue, scope, verdict, description, action }) {
      const value = matchValue.toLowerCase();
      const slug = `${scope}:${value}`;
      let row = rows.find(r => r.slug === slug);
      if (!row) { row = { userId, slug, description, body: "", scope, matchType: scope, matchValue: value, verdict, action: action ?? null }; rows.push(row); }
      else { row.verdict = verdict; row.description = description; row.action = action ?? row.action; }
      return row;
    },
    deleteBySlug(slug) { const i = rows.findIndex(r => r.slug === slug); if (i >= 0) rows.splice(i, 1); },
  };
}
