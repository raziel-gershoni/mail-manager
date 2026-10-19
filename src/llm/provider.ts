// src/llm/provider.ts
import type { EmailMeta } from "../gmail/headers.js";
import type { RiskSignals } from "../gmail/risk.js";
import type { MemoryIndexEntry } from "../memory/store.js";
import type { AgentMessage } from "../context/assemble.js";
import type { RuleTag } from "../agent/rule-tag.js";
import type { AttachmentRead } from "../attachments/read.js";

export interface ClassifyInput { email: EmailMeta; risk: RiskSignals; memoryIndex: MemoryIndexEntry[]; }
export interface ClassifyResult { important: boolean; suspicious: boolean; reason: string; matched?: string; }

export interface ToolSchema { name: string; description: string; parameters: Record<string, unknown>; }
// `id` is the call id Gemini 3 attaches to every functionCall; it must be echoed on the
// matching functionResponse so the model can map each result back to its call.
export interface ToolCall { name: string; args: Record<string, unknown>; id?: string; thoughtSignature?: string; }
export type AgentStep = { kind: "tool_calls"; calls: ToolCall[] } | { kind: "final"; text: string };

// Where a streaming agent step reports its progress. Both methods are synchronous
// and must not throw: the provider calls them from inside the stream loop, and
// progress reporting can never be allowed to break the turn.
export interface StreamSink {
  onText(delta: string): void; // a user-visible text delta (never the model's reasoning)
  onToolCall(): void;          // this step is calling a tool, so its prose was not the answer
}
// attachments: what was read of the email's files (extracts are UNTRUSTED), and the
// ones that weren't, with why; absent when it has none.
export interface BriefEmail { from: string; subject: string; bodyText: string; rule?: RuleTag | null; attachments?: AttachmentRead[]; }

// attachmentLine: the message's files as one compact line (attachmentLine() in
// src/gmail/parts.ts); absent when it has none.
export interface TrashCandidate { id: string; from: string; subject: string; bulk: boolean; transactional: boolean; bodyText?: string; attachmentLine?: string; }
export interface ReviewVerdict { id: string; keep: boolean; reason: string; }

// The weekly retrospect's second look at one trashed/archived message. Everything but
// id, action and why is copied from the email (UNTRUSTED); `why` is what made the bot act.
export interface ActedCandidate { id: string; from: string; subject: string; snippet: string; action: "trashed" | "archived"; why: string; attachmentLine?: string }
export interface ActedVerdict { id: string; looksWrong: boolean; reason: string }

// The weekly spam check's view of one email in Spam. Everything but the two signals is
// UNTRUSTED (it came from the email); attachmentLine is set only when it has attachments.
export interface SpamCandidate { id: string; from: string; subject: string; snippet: string; bulk: boolean; transactional: boolean; attachmentLine?: string }
// legitimate: plausibly real mail the owner would want (it gets flagged for the owner to
// rescue). suspicious: phishing-like (flagged ones are marked "rescue only if you're sure").
export interface SpamVerdict { id: string; legitimate: boolean; suspicious: boolean; reason: string }

export interface LLMProvider {
  classifyImportance(input: ClassifyInput): Promise<ClassifyResult>;
  // With a sink, the step streams and reports deltas as they arrive; without one it
  // behaves exactly as before. The returned AgentStep is identical either way.
  agentStep(messages: AgentMessage[], tools: ToolSchema[], sink?: StreamSink): Promise<AgentStep>;
  writeBrief(emails: BriefEmail[], context?: string): Promise<string>;
  // Transcribes one attachment (PDF, image, text/CSV) to plain text. `data` is standard
  // base64. The file and its name are UNTRUSTED: transcribed, never obeyed. `maxChars` is
  // the caller's budget for this file: the extract aims to fit it (key facts first) and the
  // output is capped near it, so a long PDF neither times out nor burns output tokens on
  // text the caller would cut. A reply cut at the cap still returns its partial text.
  extractAttachment(file: { name: string; mimeType: string; data: string }, opts?: { maxChars?: number }): Promise<string>;
  reviewTrash(candidates: TrashCandidate[]): Promise<ReviewVerdict[]>;
  reviewPreference(candidates: TrashCandidate[], preference: string): Promise<ReviewVerdict[]>;
  // One model call over one batch (the caller batches). Verdicts come back only for ids it
  // actually judged; `unjudged` counts the rest — see parseSpamJson.
  reviewSpam(candidates: SpamCandidate[]): Promise<{ verdicts: SpamVerdict[]; unjudged: number }>;
  // The retrospect's second look (default thinking): one call for the items given — the
  // caller batches. A missing or malformed verdict is NOT flagged and is counted in
  // `unjudged` (parseActedJson).
  reviewActed(items: ActedCandidate[]): Promise<{ verdicts: ActedVerdict[]; unjudged: number }>;
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

// Parse reviewSpam's reply. The OPPOSITE default from parseReviewJson: a spam verdict
// can only ever FLAG mail for the owner to look at, so the safe error is "not flagged".
// A reply that isn't JSON, an id the model left out, or a verdict whose `legitimate` isn't
// a real boolean is "couldn't judge": no verdict, counted in `unjudged`, never guessed.
// `suspicious` counts only when it is exactly true. Ids the model invented are ignored.
export function parseSpamJson(text: string, ids: string[]): { verdicts: SpamVerdict[]; unjudged: number } {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { verdicts: [], unjudged: ids.length }; }
  const byId = new Map<string, Record<string, unknown>>();
  for (const v of Array.isArray(parsed) ? parsed : []) {
    if (v && typeof v === "object" && typeof (v as Record<string, unknown>).id === "string") {
      const id = (v as Record<string, unknown>).id as string;
      if (!byId.has(id)) byId.set(id, v as Record<string, unknown>); // first verdict for an id wins
    }
  }
  const verdicts: SpamVerdict[] = [];
  for (const id of ids) {
    const v = byId.get(id);
    if (!v || typeof v.legitimate !== "boolean") continue;
    verdicts.push({ id, legitimate: v.legitimate, suspicious: v.suspicious === true, reason: typeof v.reason === "string" ? v.reason : "" });
  }
  return { verdicts, unjudged: ids.length - verdicts.length };
}

// Second-look verdicts, with the OPPOSITE default from parseReviewJson. Nothing here acts
// on mail, so the safe error is a missed flag: an id the model left out, a verdict that
// isn't a boolean, or output that isn't a JSON array is NOT flagged. It is counted in
// `unjudged`, so the report can say "couldn't re-check N" instead of implying a clean
// week. Only an explicit looksWrong:true flags.
export function parseActedJson(text: string, ids: string[]): { verdicts: ActedVerdict[]; unjudged: number } {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { verdicts: [], unjudged: ids.length }; }
  const byId = new Map<string, Record<string, unknown>>();
  for (const v of Array.isArray(parsed) ? parsed : []) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (typeof o.id === "string" && !byId.has(o.id)) byId.set(o.id, o);
  }
  const verdicts: ActedVerdict[] = [];
  for (const id of ids) {
    const v = byId.get(id);
    if (!v || typeof v.looksWrong !== "boolean") continue;
    verdicts.push({ id, looksWrong: v.looksWrong, reason: typeof v.reason === "string" ? v.reason : "" });
  }
  return { verdicts, unjudged: ids.length - verdicts.length };
}

// What every fake's reviewActed does unless a test scripts its own: judges each item,
// finds nothing wrong.
async function fakeReviewActed(items: ActedCandidate[]): Promise<{ verdicts: ActedVerdict[]; unjudged: number }> {
  return { verdicts: items.map(i => ({ id: i.id, looksWrong: false, reason: "fake" })), unjudged: 0 };
}

export function fakeReviewLLM(fn: (c: TrashCandidate[]) => ReviewVerdict[]): LLMProvider {
  return {
    async classifyImportance() { return { important: true, suspicious: false, reason: "fake" }; },
    async agentStep() { return { kind: "final", text: "" }; },
    async writeBrief() { return ""; },
    async extractAttachment() { return ""; },
    async reviewTrash(c) { return fn(c); },
    async reviewPreference(c) { return fn(c); },
    async reviewSpam(c) { return { verdicts: [], unjudged: c.length }; },
    reviewActed: fakeReviewActed,
  };
}

export function fakeLLM(fn: (i: ClassifyInput) => ClassifyResult): LLMProvider {
  return {
    async classifyImportance(i) { return fn(i); },
    async agentStep() { return { kind: "final", text: "" }; },
    async writeBrief() { return ""; },
    async extractAttachment() { return ""; },
    async reviewTrash() { return []; },
    async reviewPreference() { return []; },
    async reviewSpam(c) { return { verdicts: [], unjudged: c.length }; },
    reviewActed: fakeReviewActed,
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
    async extractAttachment() { return ""; },
    async reviewTrash() { return []; },
    async reviewPreference() { return []; },
    async reviewSpam(c) { return { verdicts: [], unjudged: c.length }; },
    reviewActed: fakeReviewActed,
  };
}
