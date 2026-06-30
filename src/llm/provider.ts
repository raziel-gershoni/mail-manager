// src/llm/provider.ts
import type { EmailMeta } from "../gmail/headers.js";
import type { RiskSignals } from "../gmail/risk.js";
import type { MemoryIndexEntry } from "../memory/store.js";

export interface ClassifyInput { email: EmailMeta; risk: RiskSignals; memoryIndex: MemoryIndexEntry[]; }
export interface ClassifyResult { important: boolean; suspicious: boolean; reason: string; }
export interface LLMProvider { classifyImportance(input: ClassifyInput): Promise<ClassifyResult>; }

export function fakeLLM(fn: (i: ClassifyInput) => ClassifyResult): LLMProvider {
  return { async classifyImportance(i) { return fn(i); } };
}
