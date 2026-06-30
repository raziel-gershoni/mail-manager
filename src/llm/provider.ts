// src/llm/provider.ts
import type { EmailMeta } from "../gmail/headers.js";
import type { RiskSignals } from "../gmail/risk.js";
import type { MemoryIndexEntry } from "../memory/store.js";
import type { AgentMessage } from "../context/assemble.js";

export interface ClassifyInput { email: EmailMeta; risk: RiskSignals; memoryIndex: MemoryIndexEntry[]; }
export interface ClassifyResult { important: boolean; suspicious: boolean; reason: string; }

export interface ToolSchema { name: string; description: string; parameters: Record<string, unknown>; }
export interface ToolCall { name: string; args: Record<string, unknown>; }
export type AgentStep = { kind: "tool_calls"; calls: ToolCall[] } | { kind: "final"; text: string };
export interface BriefEmail { from: string; subject: string; bodyText: string; }

export interface LLMProvider {
  classifyImportance(input: ClassifyInput): Promise<ClassifyResult>;
  agentStep(messages: AgentMessage[], tools: ToolSchema[]): Promise<AgentStep>;
  writeBrief(emails: BriefEmail[]): Promise<string>;
}

export function fakeLLM(fn: (i: ClassifyInput) => ClassifyResult): LLMProvider {
  return {
    async classifyImportance(i) { return fn(i); },
    async agentStep() { return { kind: "final", text: "" }; },
    async writeBrief() { return ""; },
  };
}

export function fakeAgentLLM(
  script: (messages: AgentMessage[], tools: ToolSchema[]) => AgentStep,
  brief: (emails: BriefEmail[]) => string = () => "",
): LLMProvider {
  return {
    async classifyImportance() { return { important: true, suspicious: false, reason: "fake" }; },
    async agentStep(messages, tools) { return script(messages, tools); },
    async writeBrief(emails) { return brief(emails); },
  };
}
