import { estimateTokens } from "./tokens.js";
import type { ConversationState, Turn } from "../conversation/store.js";
import type { MemoryIndexEntry } from "../memory/store.js";

export interface AgentMessage { role: "system" | "user" | "assistant" | "tool"; content: string; name?: string; }
export const COMPACT_TOKENS = 40_000;

export function buildAgentMessages(
  system: string, memoryIndex: MemoryIndexEntry[], state: ConversationState, userText: string,
): AgentMessage[] {
  const rules = memoryIndex.length ? memoryIndex.map(m => `- ${m.description}`).join("\n") : "(none yet)";
  const summary = state.summary ? `\n\nConversation so far:\n${state.summary}` : "";
  const sys = `${system}\n\nLearned preferences:\n${rules}${summary}`;
  const out: AgentMessage[] = [{ role: "system", content: sys }];
  for (const t of state.window) out.push({ role: t.role === "brief" ? "assistant" : t.role, content: t.content });
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
