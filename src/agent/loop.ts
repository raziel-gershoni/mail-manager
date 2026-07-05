import type { AgentMessage } from "../context/assemble.js";
import type { LLMProvider } from "../llm/provider.js";
import type { ToolDef, ToolContext } from "./tools.js";
import { dispatchTool } from "./tools.js";
import { log } from "../util/log.js";

export const MAX_TOOL_ITERS = 10;
// Wall-clock budgets keep a single turn under Vercel's 60s worker cap: stop *planning*
// after AGENT_BUDGET_MS, then force one bounded final-answer call so the owner always
// gets a reply instead of a silent timeout.
export const AGENT_BUDGET_MS = 45_000;
export const FORCE_FINAL_MS = 12_000;

export interface AgentResult { text: string; toolNote: string; }

const TIMED_OUT = Symbol("timeout");
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  // The underlying promise keeps running if the timeout wins; we just stop awaiting it.
  return Promise.race([p, new Promise<typeof TIMED_OUT>(r => setTimeout(() => r(TIMED_OUT), ms))]);
}

// Log-safe projection of one tool-result item: keeps who/what + a short preview,
// never the full body. (read_messages items carry `bodyText`; only a truncated
// preview of it is logged.)
function projectItem(it: unknown): unknown {
  if (!it || typeof it !== "object") return it;
  const o = it as Record<string, unknown>;
  if (!("from" in o) && !("subject" in o) && !("id" in o)) return it;
  const p: Record<string, unknown> = {};
  for (const k of ["id", "from", "subject", "verdict", "action", "reason"]) if (k in o) p[k] = o[k];
  if (typeof o.snippet === "string") p.snippet = o.snippet.slice(0, 160);
  if (typeof o.bodyText === "string") p.preview = o.bodyText.slice(0, 200); // truncated; never the full 40k body
  return p;
}

// Log-safe summary of a tool result: detail email-like arrays (search/read) with
// senders/subjects; count-only for the rest. Never dumps full bodies or secrets.
function summarize(result: unknown): unknown {
  if (Array.isArray(result)) {
    const first = result[0] as Record<string, unknown> | undefined;
    if (first && typeof first === "object" && ("from" in first || "subject" in first)) {
      return { n: result.length, items: result.slice(0, 25).map(projectItem) };
    }
    return { n: result.length };
  }
  if (result && typeof result === "object") {
    const o = result as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of ["ok", "count", "query", "counts", "archived", "trashed", "kept", "guardedTrashed", "guardedArchived", "skipped", "gated", "willTrash", "setAside", "undecided", "capped", "error", "proposalId", "restored"]) {
      if (k in o) out[k] = o[k];
    }
    if (Array.isArray(o.guardedKept)) out.guardedKept = (o.guardedKept as unknown[]).map(projectItem);
    return Object.keys(out).length ? out : { keys: Object.keys(o) };
  }
  return result;
}

export async function runAgentTurn(
  messages: AgentMessage[],
  deps: { llm: LLMProvider; tools: ToolDef[]; ctx: ToolContext; maxIters?: number; budgetMs?: number },
): Promise<AgentResult> {
  const max = deps.maxIters ?? MAX_TOOL_ITERS;
  const budget = deps.budgetMs ?? AGENT_BUDGET_MS;
  const schemas = deps.tools.map(t => t.schema);
  const convo = [...messages];
  const used: string[] = [];
  const start = Date.now();
  let stop = "iters";
  for (let i = 0; i < max; i++) {
    const remaining = budget - (Date.now() - start);
    if (remaining < 3000) { stop = "budget"; break; }
    const stepStart = Date.now();
    const step = await withTimeout(deps.llm.agentStep(convo, schemas), remaining);
    const stepMs = Date.now() - stepStart;
    if (step === TIMED_OUT) { log("agent.step_timeout", { iter: i, ms: stepMs }); stop = "budget"; break; }
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
        log("agent.tool", { iter: i, name: call.name, args: call.args, result: summarize(result), ms: Date.now() - toolStart });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        result = { error };
        log("agent.tool", { iter: i, name: call.name, args: call.args, error, ms: Date.now() - toolStart });
      }
      convo.push({ role: "tool", name: call.name, result });
    }
  }
  // Ran out of tool rounds or time — force a bounded final answer using what we've gathered (no tools).
  log("agent.exhausted", { stop, iters: used.length, tools: used, ms: Date.now() - start });
  try {
    const forced = await withTimeout(
      deps.llm.agentStep(
        [...convo, { role: "user", content: "You've used your tool budget. Give the owner your best final answer NOW using what you've already found. If you couldn't find what they meant, say so briefly and ask them to clarify (e.g. the sender's email). Do NOT call any tools." }],
        [],
      ),
      FORCE_FINAL_MS,
    );
    if (forced !== TIMED_OUT && forced.kind === "final") {
      log("agent.forced_final", { tools: used });
      return { text: forced.text, toolNote: used.join(",") || "none" };
    }
    log("agent.forced_final_timeout", {});
  } catch (e) {
    log("agent.forced_final_error", { error: e instanceof Error ? e.message : String(e) });
  }
  return { text: "Sorry — I looked but ran out of time on that one. Could you narrow it down — e.g. give me the sender's email address?", toolNote: used.join(",") || "none" };
}
