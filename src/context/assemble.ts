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
