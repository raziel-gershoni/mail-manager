import type { AgentMessage } from "../context/assemble.js";
import type { LLMProvider } from "../llm/provider.js";
import type { ToolDef, ToolContext } from "./tools.js";
import { dispatchTool } from "./tools.js";

export const MAX_TOOL_ITERS = 8;
export interface AgentResult { text: string; toolNote: string; }

export async function runAgentTurn(
  messages: AgentMessage[],
  deps: { llm: LLMProvider; tools: ToolDef[]; ctx: ToolContext; maxIters?: number },
): Promise<AgentResult> {
  const max = deps.maxIters ?? MAX_TOOL_ITERS;
  const schemas = deps.tools.map(t => t.schema);
  const convo = [...messages];
  const used: string[] = [];
  for (let i = 0; i < max; i++) {
    const step = await deps.llm.agentStep(convo, schemas);
    if (step.kind === "final") return { text: step.text, toolNote: used.join(",") || "none" };
    convo.push({ role: "assistant", content: JSON.stringify(step.calls) });
    for (const call of step.calls) {
      used.push(call.name);
      let result: unknown;
      try { result = await dispatchTool(call.name, call.args, deps.ctx, deps.tools); }
      catch (e) { result = { error: e instanceof Error ? e.message : String(e) }; }
      convo.push({ role: "tool", name: call.name, content: JSON.stringify(result).slice(0, 40_000) });
    }
  }
  return { text: "Sorry — I couldn't complete that in time. Could you narrow it down?", toolNote: used.join(",") || "none" };
}
