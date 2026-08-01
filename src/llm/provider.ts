// src/llm/provider.ts
import type { EmailMeta } from "../gmail/headers.js";
import type { RiskSignals } from "../gmail/risk.js";
import type { MemoryIndexEntry } from "../memory/store.js";
import type { AgentMessage } from "../context/assemble.js";
import type { RuleTag } from "../agent/rule-tag.js";

export interface ClassifyInput { email: EmailMeta; risk: RiskSignals; memoryIndex: MemoryIndexEntry[]; }
export interface ClassifyResult { important: boolean; suspicious: boolean; reason: string; matched?: string; }

export interface ToolSchema { name: string; description: string; parameters: Record<string, unknown>; }
export interface ToolCall { name: string; args: Record<string, unknown>; thoughtSignature?: string; }
export type AgentStep = { kind: "tool_calls"; calls: ToolCall[] } | { kind: "final"; text: string };

// Where a streaming agent step reports its progress. Both methods are synchronous
// and must not throw: the provider calls them from inside the stream loop, and
// progress reporting can never be allowed to break the turn.
export interface StreamSink {
  onText(delta: string): void; // a user-visible text delta (never the model's reasoning)
  onToolCall(): void;          // this step is calling a tool, so its prose was not the answer
}
export interface BriefEmail { from: string; subject: string; bodyText: string; rule?: RuleTag | null; }

export interface TrashCandidate { id: string; from: string; subject: string; bulk: boolean; transactional: boolean; bodyText?: string; }
export interface ReviewVerdict { id: string; keep: boolean; reason: string; }

export interface LLMProvider {
  classifyImportance(input: ClassifyInput): Promise<ClassifyResult>;
  // With a sink, the step streams and reports deltas as they arrive; without one it
  // behaves exactly as before. The returned AgentStep is identical either way.
  agentStep(messages: AgentMessage[], tools: ToolSchema[], sink?: StreamSink): Promise<AgentStep>;
  writeBrief(emails: BriefEmail[], context?: string): Promise<string>;
  reviewTrash(candidates: TrashCandidate[]): Promise<ReviewVerdict[]>;
  reviewPreference(candidates: TrashCandidate[], preference: string): Promise<ReviewVerdict[]>;
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
    // Only an EXPLICIT keep:false may act. A judged id whose keep is malformed or
    // absent ("yes", null, missing) is an ambiguous verdict, not a licence to trash:
    // coercing it to false would turn model sloppiness into a false trash. Same rule
    // as the unjudged case above — the safe error is a false keep, never a false trash.
    return { id, keep: v.keep !== false, reason: typeof v.reason === "string" ? v.reason : "" };
  });
}

export function fakeReviewLLM(fn: (c: TrashCandidate[]) => ReviewVerdict[]): LLMProvider {
  return {
    async classifyImportance() { return { important: true, suspicious: false, reason: "fake" }; },
    async agentStep() { return { kind: "final", text: "" }; },
    async writeBrief() { return ""; },
    async reviewTrash(c) { return fn(c); },
    async reviewPreference(c) { return fn(c); },
  };
}

export function fakeLLM(fn: (i: ClassifyInput) => ClassifyResult): LLMProvider {
  return {
    async classifyImportance(i) { return fn(i); },
    async agentStep() { return { kind: "final", text: "" }; },
    async writeBrief() { return ""; },
    async reviewTrash() { return []; },
    async reviewPreference() { return []; },
  };
}

export function fakeAgentLLM(
  script: (messages: AgentMessage[], tools: ToolSchema[], sink?: StreamSink) => AgentStep,
  brief: (emails: BriefEmail[], context?: string) => string = () => "",
): LLMProvider {
  return {
    async classifyImportance() { return { important: true, suspicious: false, reason: "fake" }; },
    async agentStep(messages, tools, sink) { return script(messages, tools, sink); },
    async writeBrief(emails, context) { return brief(emails, context); },
    async reviewTrash() { return []; },
    async reviewPreference() { return []; },
  };
}
