import type { EmailMeta } from "../gmail/headers.js";
import { riskSignals } from "../gmail/risk.js";
import type { MemoryStore } from "../memory/store.js";
import type { LLMProvider } from "../llm/provider.js";

export interface ClassifyDeps { store: MemoryStore; llm: LLMProvider; }
export interface ClassifyOutcome {
  important: boolean; suspicious: boolean; reason: string; source: "rule" | "llm";
}

export async function classifyEmail(email: EmailMeta, deps: ClassifyDeps): Promise<ClassifyOutcome> {
  const rule = deps.store.findRuleFor(email.fromEmail, email.fromDomain);
  if (rule) {
    return { important: rule.verdict === "important", suspicious: false, reason: `rule:${rule.slug}`, source: "rule" };
  }
  const risk = riskSignals(email);
  try {
    const r = await deps.llm.classifyImportance({ email, risk, memoryIndex: deps.store.index() });
    return { ...r, source: "llm" };
  } catch {
    return { important: true, suspicious: true, reason: "llm-error-fallback", source: "llm" };
  }
}
