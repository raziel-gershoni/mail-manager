import type { AgentMessage } from "../context/assemble.js";
import type { LLMProvider } from "../llm/provider.js";
import type { ToolDef, ToolContext } from "./tools.js";
import { dispatchTool } from "./tools.js";
import { log } from "../util/log.js";

export const MAX_TOOL_ITERS = 10;
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
    const stepStart = Date.now();
    const step = await deps.llm.agentStep(convo, schemas);
    const stepMs = Date.now() - stepStart;
    if (step.kind === "final") {
      log("agent.final", { iter: i, tools: used, ms: stepMs });
      return { text: step.text, toolNote: used.join(",") || "none" };
    }
    log("agent.step", { iter: i, calls: step.calls.map(c => c.name), ms: stepMs });
    convo.push({ role: "assistant", toolCalls: step.calls });
    for (const call of step.calls) {
      used.push(call.name);
      let result: unknown;
      const toolStart = Date.now();
      try {
        result = await dispatchTool(call.name, call.args, deps.ctx, deps.tools);
        log("agent.tool", { iter: i, name: call.name, args: call.args, ms: Date.now() - toolStart });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        result = { error };
        log("agent.tool", { iter: i, name: call.name, args: call.args, error, ms: Date.now() - toolStart });
      }
      convo.push({ role: "tool", name: call.name, result });
    }
  }
  log("agent.exhausted", { iters: max, tools: used });
  try {
    const forced = await deps.llm.agentStep(
      [...convo, { role: "user", content: "You've used all your tool steps. Give the owner your best final answer now using what you've already found. Do NOT call any tools." }],
      [],
    );
    if (forced.kind === "final") { log("agent.forced_final", { tools: used }); return { text: forced.text, toolNote: used.join(",") || "none" }; }
  } catch (e) {
    log("agent.forced_final_error", { error: e instanceof Error ? e.message : String(e) });
  }
  return { text: "Sorry — I ran out of steps on that one. Could you narrow it down?", toolNote: used.join(",") || "none" };
}
