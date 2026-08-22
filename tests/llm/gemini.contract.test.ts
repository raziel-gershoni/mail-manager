// Live contract test against the real Gemini API. Skipped unless GEMINI_API_KEY is
// set, so CI and ordinary `npm test` runs are unaffected:
//
//   set -a; . ./.env; set +a; npx vitest run tests/llm/gemini.contract.test.ts
//
// The rest of the suite proves our code is self-consistent against fakes. This proves
// the things only the live model can: that the configured MODEL id exists, that it
// still accepts the request shape we send it, and — the one that has actually bitten
// this codebase — that echoing a thoughtSignature back is accepted rather than
// rejected with INVALID_ARGUMENT. Re-run it whenever MODEL or the SDK changes.
import { describe, it, expect } from "vitest";
import type { AgentMessage } from "../../src/context/assemble.js";
import type { StreamSink, ToolSchema } from "../../src/llm/provider.js";

const KEY = process.env.GEMINI_API_KEY;
const RUN = !!KEY;

// Deliberately a tool the model cannot resist for this question: the point is to get
// a tool_calls step back, not to exercise our real tool surface.
const CLOCK: ToolSchema = {
  name: "get_current_time",
  description: "Returns the current time in the owner's timezone. Call this whenever the owner asks what time it is.",
  parameters: { type: "object", properties: { timezone: { type: "string", description: "IANA timezone name" } }, required: [] },
};

describe.skipIf(!RUN)("gemini live contract", () => {
  it("answers a plain question (MODEL id is real and reachable)", async () => {
    const { geminiProvider } = await import("../../src/llm/gemini.js");
    const step = await geminiProvider(KEY!).agentStep(
      [{ role: "user", content: "Reply with exactly the word: pong" }],
      [],
    );
    expect(step.kind).toBe("final");
    if (step.kind === "final") expect(step.text.toLowerCase()).toContain("pong");
  }, 60_000);

  it("round-trips a tool call AND accepts the thoughtSignature echoed back", async () => {
    // The failure this guards: Gemini 3 rejects a follow-up turn with INVALID_ARGUMENT
    // if the thoughtSignature it attached to a functionCall part is not echoed. Our
    // toGeminiContents does echo it — this proves the live model still accepts that.
    const { geminiProvider } = await import("../../src/llm/gemini.js");
    const llm = geminiProvider(KEY!);
    const first = await llm.agentStep([{ role: "user", content: "What time is it right now?" }], [CLOCK]);
    expect(first.kind).toBe("tool_calls");
    if (first.kind !== "tool_calls") return;
    expect(first.calls[0]!.name).toBe("get_current_time");

    // Feed the call and its result back exactly as the agent loop does.
    const convo: AgentMessage[] = [
      { role: "user", content: "What time is it right now?" },
      { role: "assistant", toolCalls: first.calls },
      { role: "tool", name: first.calls[0]!.name, result: { time: "14:30", timezone: "Asia/Jerusalem" } },
    ];
    const second = await llm.agentStep(convo, [CLOCK]);
    expect(second.kind).toBe("final");
    if (second.kind === "final") expect(second.text).toContain("14:30");
  }, 90_000);

  it("streams deltas without ever leaking a thought part", async () => {
    const { geminiProvider } = await import("../../src/llm/gemini.js");
    const deltas: string[] = [];
    const sink: StreamSink = { onText: d => { deltas.push(d); }, onToolCall: () => {} };
    const step = await geminiProvider(KEY!).agentStep(
      [{ role: "user", content: "Count from 1 to 10, separated by spaces. No other words." }],
      [],
      sink,
    );
    expect(step.kind).toBe("final");
    expect(deltas.length).toBeGreaterThan(0);
    // What the sink saw must be exactly the answer — no reasoning spliced in.
    if (step.kind === "final") expect(deltas.join("")).toBe(step.text);
  }, 60_000);

  it("still honours responseMimeType + temperature on the JSON paths", async () => {
    // temperature was deprecated on 2026-07-21. It is still accepted today; when that
    // stops being true, this test is where we find out — not the owner's inbox.
    const { geminiProvider } = await import("../../src/llm/gemini.js");
    const res = await geminiProvider(KEY!).classifyImportance({
      email: {
        id: "1", threadId: "1", from: "Acme Billing <billing@acme.com>", fromEmail: "billing@acme.com",
        fromDomain: "acme.com", subject: "Your invoice #1234 is ready",
        snippet: "Your monthly invoice is attached.", date: new Date("2026-08-22T09:00:00Z"),
        headers: {}, labelIds: ["INBOX"],
      },
      risk: { bulk: false, hasListUnsubscribe: false, transactional: true },
      memoryIndex: [],
    });
    // Assert the CONTRACT (parseable, well-typed), not the model's judgment — the
    // verdict itself is allowed to differ between model generations.
    expect(typeof res.important).toBe("boolean");
    expect(typeof res.suspicious).toBe("boolean");
    expect(typeof res.reason).toBe("string");
  }, 60_000);
});
