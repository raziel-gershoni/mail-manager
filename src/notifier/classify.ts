import type { EmailMeta } from "../gmail/headers.js";
import { riskSignals } from "../gmail/risk.js";
import type { MemoryStore } from "../memory/store.js";
import type { PrefAction } from "../memory/preferences.js";
import type { LLMProvider } from "../llm/provider.js";

export interface ClassifyDeps { store: MemoryStore; llm: LLMProvider; }
export interface ClassifyOutcome {
  important: boolean; suspicious: boolean; reason: string; source: "rule" | "llm";
  matched: { key: string; action: PrefAction } | null;
}

export async function classifyEmail(email: EmailMeta, deps: ClassifyDeps): Promise<ClassifyOutcome> {
  const rule = deps.store.findRuleFor(email.fromEmail, email.fromDomain);
  if (rule) {
    // Precedence: an explicit sender/domain rule always wins over a fuzzy topic match.
    return { important: rule.verdict === "important", suspicious: false, reason: `rule:${rule.slug}`, source: "rule", matched: null };
  }
  const risk = riskSignals(email);
  const index = deps.store.index();
  try {
    const r = await deps.llm.classifyImportance({ email, risk, memoryIndex: index });
    // The model names a KEY; the STORE supplies the action. A key the model invented,
    // or one whose preference is advisory-only, resolves to no action.
    const hit = r.matched ? index.find(m => m.key === r.matched) : undefined;
    const action = hit?.action === "trash" || hit?.action === "archive" ? hit.action : null;
    return { ...r, source: "llm", matched: action ? { key: hit!.key, action } : null };
  } catch {
    return { important: true, suspicious: true, reason: "llm-error-fallback", source: "llm", matched: null };
  }
}
