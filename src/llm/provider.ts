// src/llm/provider.ts
import type { EmailMeta } from "../gmail/headers.js";
import type { RiskSignals } from "../gmail/risk.js";
import type { MemoryIndexEntry } from "../memory/store.js";
import type { AgentMessage } from "../context/assemble.js";

export interface ClassifyInput { email: EmailMeta; risk: RiskSignals; memoryIndex: MemoryIndexEntry[]; }
export interface ClassifyResult { important: boolean; suspicious: boolean; reason: string; }

export interface ToolSchema { name: string; description: string; parameters: Record<string, unknown>; }
export interface ToolCall { name: string; args: Record<string, unknown>; thoughtSignature?: string; }
export type AgentStep = { kind: "tool_calls"; calls: ToolCall[] } | { kind: "final"; text: string };
export interface BriefEmail { from: string; subject: string; bodyText: string; }

export interface TrashCandidate { id: string; from: string; subject: string; bulk: boolean; transactional: boolean; bodyText?: string; }
export interface ReviewVerdict { id: string; keep: boolean; reason: string; }

export interface LLMProvider {
  classifyImportance(input: ClassifyInput): Promise<ClassifyResult>;
  agentStep(messages: AgentMessage[], tools: ToolSchema[]): Promise<AgentStep>;
  writeBrief(emails: BriefEmail[], context?: string): Promise<string>;
  reviewTrash(candidates: TrashCandidate[]): Promise<ReviewVerdict[]>;
}

export function parseReviewJson(text: string, candidateIds: string[]): ReviewVerdict[] {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return candidateIds.map(id => ({ id, keep: true, reason: "parse-fail-rescue" })); }
  const arr = Array.isArray(parsed) ? parsed as Record<string, unknown>[] : [];
  const byId = new Map(arr.filter(v => typeof v.id === "string").map(v => [v.id as string, v]));
  return candidateIds.map(id => {
    const v = byId.get(id);
    // An id the model never returned was NOT judged — default to keep. The safe
    // error is a false keep, never a false trash (a well-formed but incomplete
    // array must not silently trash an unjudged message).
    if (!v) return { id, keep: true, reason: "unjudged-rescue" };
    return { id, keep: v.keep === true, reason: typeof v.reason === "string" ? v.reason : "" };
  });
}

export function fakeReviewLLM(fn: (c: TrashCandidate[]) => ReviewVerdict[]): LLMProvider {
  return {
    async classifyImportance() { return { important: true, suspicious: false, reason: "fake" }; },
    async agentStep() { return { kind: "final", text: "" }; },
    async writeBrief() { return ""; },
    async reviewTrash(c) { return fn(c); },
  };
}

export function fakeLLM(fn: (i: ClassifyInput) => ClassifyResult): LLMProvider {
  return {
    async classifyImportance(i) { return fn(i); },
    async agentStep() { return { kind: "final", text: "" }; },
    async writeBrief() { return ""; },
    async reviewTrash() { return []; },
  };
}

export function fakeAgentLLM(
  script: (messages: AgentMessage[], tools: ToolSchema[]) => AgentStep,
  brief: (emails: BriefEmail[], context?: string) => string = () => "",
): LLMProvider {
  return {
    async classifyImportance() { return { important: true, suspicious: false, reason: "fake" }; },
    async agentStep(messages, tools) { return script(messages, tools); },
    async writeBrief(emails, context) { return brief(emails, context); },
    async reviewTrash() { return []; },
  };
}
