export type Role = "user" | "assistant" | "brief";
export interface Turn { role: Role; content: string; toolNote?: string; }
export interface ConversationState { summary: string; window: Turn[]; }
export interface ConversationRepo {
  load(userId: number): Promise<ConversationState>;
  appendTurn(userId: number, turn: Turn): Promise<void>;
  replaceState(userId: number, state: ConversationState): Promise<void>;
}

export function fakeConversationRepo(): ConversationRepo {
  const m = new Map<number, ConversationState>();
  const get = (u: number) => m.get(u) ?? { summary: "", window: [] };
  return {
    async load(u) { const s = get(u); return { summary: s.summary, window: s.window.map(t => ({ ...t })) }; },
    async appendTurn(u, t) { const s = get(u); m.set(u, { summary: s.summary, window: [...s.window, { ...t }] }); },
    async replaceState(u, state) { m.set(u, { summary: state.summary, window: state.window.map(t => ({ ...t })) }); },
  };
}
