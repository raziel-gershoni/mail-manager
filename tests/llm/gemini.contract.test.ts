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

// A one-page PDF whose only content is `text` (Helvetica, ASCII), with a valid xref —
// small enough to inline, real enough that pdftotext reads it back.
function tinyPdf(text: string): string {
  const esc = text.replace(/[\\()]/g, m => "\\" + m);
  const stream = `BT /F1 18 Tf 50 750 Td (${esc}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1").toString("base64"); // standard base64, as inlineData wants
}

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

  // Both transports: the bot always streams (the worker passes a sink), and falls back
  // to the plain call only when a stream fails before emitting anything.
  for (const transport of ["streamed", "non-streamed"] as const) {
    it(`round-trips a tool call AND accepts the thoughtSignature and call id echoed back (${transport})`, async () => {
      // The failure this guards: Gemini 3 rejects a follow-up turn with INVALID_ARGUMENT
      // if the thoughtSignature it attached to a functionCall part is not echoed. Our
      // toGeminiContents does echo it — this proves the live model still accepts that.
      // Same for the call id, whose absence fails silently (an empty answer) instead.
      const { geminiProvider } = await import("../../src/llm/gemini.js");
      const llm = geminiProvider(KEY!);
      const sink: StreamSink | undefined = transport === "streamed" ? { onText: () => {}, onToolCall: () => {} } : undefined;
      const first = await llm.agentStep([{ role: "user", content: "What time is it right now?" }], [CLOCK], sink);
      expect(first.kind).toBe("tool_calls");
      if (first.kind !== "tool_calls") return;
      expect(first.calls[0]!.name).toBe("get_current_time");
      for (const c of first.calls) expect(c.id).toEqual(expect.any(String)); // Gemini 3 always sends one

      // Feed the calls and their results back exactly as the agent loop does: the
      // assistant turn, then one tool result per call, each carrying its call's id.
      const convo: AgentMessage[] = [
        { role: "user", content: "What time is it right now?" },
        { role: "assistant", toolCalls: first.calls },
        ...first.calls.map((c): AgentMessage => ({ role: "tool", name: c.name, id: c.id, result: { time: "14:30", timezone: "Asia/Jerusalem" } })),
      ];
      const second = await llm.agentStep(convo, [CLOCK], sink);
      expect(second.kind).toBe("final");
      // The contract is that the answer USES the tool result, not how it formats it:
      // 3.8 often says "2:30 PM" without ever writing "14:30".
      if (second.kind === "final") expect(second.text).toMatch(/14:30|2:30/);
    }, 90_000);
  }

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

  it("still honours responseMimeType on the JSON paths", async () => {
    // We send no sampling params (temperature/topP/topK) — Google is retiring them and
    // will 400 any request that carries one; gemini-request.test.ts pins that offline.
    // This checks the live model still returns parseable JSON without them.
    const { geminiProvider } = await import("../../src/llm/gemini.js");
    const res = await geminiProvider(KEY!).classifyImportance({
      email: {
        id: "1", threadId: "1", from: "Acme Billing <billing@acme.com>", fromEmail: "billing@acme.com",
        fromDomain: "acme.com", subject: "Your invoice #1234 is ready",
        snippet: "Your monthly invoice is attached.", date: new Date("2026-08-22T09:00:00Z"),
        headers: {}, labelIds: ["INBOX"], attachments: [],
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

  it("reviewSpam returns a well-typed verdict for every spam candidate", async () => {
    // The weekly spam check's judge. The CONTRACT, not the judgment: parseable JSON, one
    // well-typed verdict per id, nothing left unjudged.
    const { geminiProvider } = await import("../../src/llm/gemini.js");
    const res = await geminiProvider(KEY!).reviewSpam([
      { id: "s1", from: "Dana Levi <dana.levi@gmail.com>", subject: "Re: dinner on Thursday?", snippet: "Sounds good, see you at 8 — I booked the place on Dizengoff.", bulk: false, transactional: false },
      { id: "s2", from: "PayPaI Security <alert@paypa1-secure.com>", subject: "URGENT: your account is locked", snippet: "Verify your password within 24 hours or your account will be closed.", bulk: false, transactional: true },
      { id: "s3", from: "Mega Deals <promo@deals-blast.biz>", subject: "90% OFF everything!!!", snippet: "Unbeatable prices on watches and more.", bulk: true, transactional: false, attachmentLine: "catalog.pdf (PDF, 2 MB)" },
    ]);
    expect(res.unjudged).toBe(0);
    expect(res.verdicts.map(v => v.id).sort()).toEqual(["s1", "s2", "s3"]);
    for (const v of res.verdicts) {
      expect(typeof v.legitimate).toBe("boolean");
      expect(typeof v.suspicious).toBe("boolean");
      expect(typeof v.reason).toBe("string");
    }
  }, 60_000);

  it("writes a brief at low thinking", async () => {
    // The brief runs with thinkingLevel LOW; this proves the live model accepts that config
    // and still returns prose. The CONTRACT, not the wording: non-empty and on-topic.
    const { geminiProvider } = await import("../../src/llm/gemini.js");
    const brief = await geminiProvider(KEY!).writeBrief([
      { from: "Leumi Bank <alerts@leumi.co.il>", subject: "Unusual activity on your card ending 4821", bodyText: "We blocked a charge of ₪3,240 at an overseas merchant. Confirm or dispute within 24h." },
    ]);
    expect(brief.trim().length).toBeGreaterThan(0);
    expect(brief).toContain("4821");
  }, 60_000);

  it("extracts the text of a PDF attachment sent as inlineData, at low thinking", async () => {
    // Proves the exact model accepts application/pdf inline data and transcribes it. The
    // CONTRACT, not the wording: the reference number and the amount come back.
    const { geminiProvider } = await import("../../src/llm/gemini.js");
    const text = await geminiProvider(KEY!).extractAttachment({
      name: "invoice.pdf", mimeType: "application/pdf", data: tinyPdf("Invoice 4821 total due 3240 ILS"),
    });
    expect(text).toContain("4821");
    expect(text).toMatch(/3,?240/);
  }, 60_000);
});
