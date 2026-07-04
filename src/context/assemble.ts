import { estimateTokens } from "./tokens.js";
import type { ConversationState, Turn } from "../conversation/store.js";
import type { MemoryIndexEntry } from "../memory/store.js";
import type { ToolCall } from "../llm/provider.js";

export type AgentMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "assistant"; toolCalls: ToolCall[] }
  | { role: "tool"; name: string; result: unknown };
type TextMessage = Extract<AgentMessage, { content: string }>;
export const COMPACT_TOKENS = 40_000;

export function buildAgentMessages(
  system: string, memoryIndex: MemoryIndexEntry[], state: ConversationState, userText: string,
): TextMessage[] {
  const rules = memoryIndex.length ? memoryIndex.map(m => `- ${m.description}`).join("\n") : "(none yet)";
  const summary = state.summary ? `\n\nConversation so far:\n${state.summary}` : "";
  const sys = `${system}\n\nLearned preferences:\n${rules}${summary}`;
  const out: TextMessage[] = [{ role: "system", content: sys }];
  for (const t of state.window) {
    out.push(t.role === "user"
      ? { role: "user", content: t.content }
      : { role: "assistant", content: t.content });
  }
  out.push({ role: "user", content: userText });
  return out;
}

export function needsCompaction(state: ConversationState, limit = COMPACT_TOKENS): boolean {
  const tokens = state.window.reduce((n, t) => n + estimateTokens(t.content), 0);
  return tokens > limit;
}

export interface ContextUsage {
  totalTokens: number;    // everything the next call carries (system + rules + summary + window), minus the new message
  systemTokens: number;   // fixed overhead: system prompt + learned rules
  summaryTokens: number;  // compacted older history
  windowTokens: number;   // recent turns
  windowTurns: number;
  compactAtTokens: number; // history compacts once the window passes this (COMPACT_TOKENS)
}

// Estimate the standing context the next agent call will send. Uses the same
// chars/4 heuristic as the compaction trigger — approximate, labelled as such.
export function contextUsage(systemPrompt: string, memoryIndex: MemoryIndexEntry[], state: ConversationState): ContextUsage {
  const rulesText = memoryIndex.length ? memoryIndex.map(m => `- ${m.description}`).join("\n") : "(none yet)";
  const systemTokens = estimateTokens(systemPrompt) + estimateTokens(rulesText);
  const summaryTokens = estimateTokens(state.summary);
  const windowTokens = state.window.reduce((n, t) => n + estimateTokens(t.content), 0);
  return {
    totalTokens: systemTokens + summaryTokens + windowTokens,
    systemTokens, summaryTokens, windowTokens,
    windowTurns: state.window.length,
    compactAtTokens: COMPACT_TOKENS,
  };
}

export async function compactState(
  state: ConversationState,
  summarize: (older: Turn[], prev: string) => Promise<string>,
  keepRecent = 8,
): Promise<ConversationState> {
  if (state.window.length <= keepRecent) return state;
  const older = state.window.slice(0, state.window.length - keepRecent);
  const recent = state.window.slice(state.window.length - keepRecent);
  const summary = await summarize(older, state.summary);
  return { summary, window: recent };
}
