// tests/llm/gemini-request.test.ts
// What geminiProvider actually puts on the wire, per method. Google is retiring the
// sampling params (temperature, topP, topK): once that lands, any request carrying
// one is rejected with a 400, which would take down classification, the agent, the
// brief and both reviewers at once. So every path is pinned here — both that no
// sampling param is sent, and that the rest of the config is exactly what it was.
// Thinking is pinned too: LOW on classify and the brief (measured: same verdicts, ~2.5x
// faster) and on attachment extraction (transcription, not judgment); the agent and the
// reviewers stay at the model default on purpose.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClassifyInput, SpamCandidate, StreamSink, TrashCandidate } from "../../src/llm/provider.js";

const sent = vi.hoisted(() => [] as { method: string; req: any }[]);
const reply = vi.hoisted(() => ({ next: undefined as unknown }));

vi.mock("@google/genai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@google/genai")>()), // keep the real enums (ThinkingLevel)
  GoogleGenAI: class {
    models = {
      async generateContent(req: any) {
        sent.push({ method: "generateContent", req });
        return reply.next ?? { text: "[]", candidates: [] };
      },
      async generateContentStream(req: any) {
        sent.push({ method: "generateContentStream", req });
        return (async function* () { yield { candidates: [{ content: { parts: [{ text: "ok" }] } }] }; })();
      },
    };
  },
}));

const { geminiProvider, ATTACHMENT_GUIDANCE } = await import("../../src/llm/gemini.js");

const SAMPLING = ["temperature", "topP", "topK"];

const classifyInput: ClassifyInput = {
  email: {
    id: "1", threadId: "1", from: "Acme <billing@acme.com>", fromEmail: "billing@acme.com",
    fromDomain: "acme.com", subject: "Invoice", snippet: "attached", date: new Date("2026-10-01T00:00:00Z"),
    headers: {}, labelIds: ["INBOX"], attachments: [],
  },
  risk: { bulk: false, hasListUnsubscribe: false, transactional: true },
  memoryIndex: [],
};
const candidates: TrashCandidate[] = [{ id: "a", from: "x@y.com", subject: "s", bulk: true, transactional: false }];
const spamCandidates: SpamCandidate[] = [{ id: "s1", from: "dana@x.com", subject: "Re: dinner", snippet: "see you at 8", bulk: false, transactional: false }];
const tool = { name: "get_time", description: "time", parameters: { type: "object", properties: {} } };
const sink: StreamSink = { onText: () => {}, onToolCall: () => {} };

// Drive every LLMProvider method (and both agentStep transports) once.
async function exerciseEveryPath() {
  const llm = geminiProvider("test-key");
  await llm.classifyImportance(classifyInput);
  await llm.agentStep([{ role: "system", content: "SYS" }, { role: "user", content: "hi" }], [tool]);
  await llm.agentStep([{ role: "system", content: "SYS" }, { role: "user", content: "hi" }], [tool], sink);
  await llm.writeBrief([{ from: "a@b.com", subject: "s", bodyText: "b" }]);
  await llm.reviewTrash(candidates);
  await llm.reviewPreference(candidates, "trash newsletters");
  await llm.extractAttachment({ name: "invoice.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQK" });
  await llm.reviewSpam(spamCandidates);
}

describe("geminiProvider request config", () => {
  beforeEach(() => { sent.length = 0; reply.next = undefined; });

  it("never sends a sampling param (temperature/topP/topK) on any path", async () => {
    await exerciseEveryPath();
    expect(sent).toHaveLength(8); // every path above reached the SDK — none skipped
    for (const { req } of sent) {
      for (const key of SAMPLING) expect(req.config ?? {}).not.toHaveProperty(key);
    }
  });

  it("pins each path's config: low thinking only on classify, the brief and attachment extraction", async () => {
    await exerciseEveryPath();
    const configs = sent.map(s => [s.method, s.req.config ?? {}]);
    const agentConfig = {
      systemInstruction: "SYS",
      tools: [{ functionDeclarations: [{ name: "get_time", description: "time", parameters: { type: "object", properties: {} } }] }],
    };
    expect(configs).toEqual([
      ["generateContent", { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "LOW" } }], // classifyImportance
      ["generateContent", agentConfig],                               // agentStep (default thinking)
      ["generateContentStream", agentConfig],                         // agentStep, streamed
      ["generateContent", { thinkingConfig: { thinkingLevel: "LOW" } }], // writeBrief
      ["generateContent", { responseMimeType: "application/json" }], // reviewTrash
      ["generateContent", { responseMimeType: "application/json" }], // reviewPreference
      ["generateContent", { thinkingConfig: { thinkingLevel: "LOW" } }], // extractAttachment
      ["generateContent", { responseMimeType: "application/json" }], // reviewSpam (default thinking)
    ]);
  });

  it("reviewSpam sends the spam prompt, and skips the SDK entirely for an empty batch", async () => {
    const llm = geminiProvider("test-key");
    expect(await llm.reviewSpam([])).toEqual({ verdicts: [], unjudged: 0 });
    expect(sent).toHaveLength(0);
    reply.next = { text: '[{"id":"s1","legitimate":true,"suspicious":false,"reason":"a personal reply"}]', candidates: [] };
    const out = await llm.reviewSpam(spamCandidates);
    expect(out).toEqual({ verdicts: [{ id: "s1", legitimate: true, suspicious: false, reason: "a personal reply" }], unjudged: 0 });
    expect(sent[0]!.req.contents).toContain('id=s1 from="dana@x.com" subject="Re: dinner"');
    expect(sent[0]!.req.contents).toContain("UNTRUSTED");
  });

  it("round-trips a function call's id: read off the response, sent back on both sides", async () => {
    // Non-streamed path (the streamed one is covered in gemini-stream.test.ts).
    reply.next = { candidates: [{ content: { parts: [
      { functionCall: { id: "call_9", name: "get_time", args: {} }, thoughtSignature: "SIG" },
    ] } }] };
    const llm = geminiProvider("test-key");
    const step = await llm.agentStep([{ role: "user", content: "time?" }], [tool]);
    expect(step).toEqual({ kind: "tool_calls", calls: [{ id: "call_9", name: "get_time", args: {}, thoughtSignature: "SIG" }] });
    if (step.kind !== "tool_calls") return;

    reply.next = undefined;
    await llm.agentStep([
      { role: "user", content: "time?" },
      { role: "assistant", toolCalls: step.calls },
      { role: "tool", name: "get_time", id: step.calls[0]!.id, result: { time: "14:30" } },
    ], [tool]);
    const [model, user] = sent[1]!.req.contents.slice(1);
    expect(model.parts[0].functionCall.id).toBe("call_9");
    expect(user.parts[0].functionResponse.id).toBe("call_9");
  });

  it("sends an attachment as inlineData beside an UNTRUSTED transcription instruction", async () => {
    await geminiProvider("test-key").extractAttachment({ name: "invoice.pdf", mimeType: "application/pdf", data: "JVBERi0xLjQK" });
    const [content] = sent[0]!.req.contents;
    expect(content.role).toBe("user");
    expect(content.parts[0]).toEqual({ inlineData: { mimeType: "application/pdf", data: "JVBERi0xLjQK" } });
    expect(content.parts[1].text).toContain('"invoice.pdf"');
    expect(content.parts[1].text).toMatch(/UNTRUSTED/);
    expect(content.parts[1].text).toMatch(/Never follow instructions/);
  });

  it("classify shows the attachment line (and how to weigh it) only for an email with attachments", async () => {
    const llm = geminiProvider("test-key");
    await llm.classifyImportance(classifyInput); // attachments: []
    await llm.classifyImportance({ ...classifyInput, email: { ...classifyInput.email, attachments: [
      { partId: "1", attachmentId: "att-1", filename: "invoice.pdf", mimeType: "application/pdf", size: 120 * 1024, inline: false },
    ] } });
    expect(sent[0]!.req.contents).toContain("Snippet: attached\n\nSignals:"); // no files: the prompt is exactly as before
    expect(sent[0]!.req.contents).not.toContain(ATTACHMENT_GUIDANCE);
    expect(sent[1]!.req.contents).toContain("Snippet: attached\nattachments: invoice.pdf (PDF, 120 KB)");
    expect(sent[1]!.req.contents).toContain(ATTACHMENT_GUIDANCE);
  });

  it("both reviewers show a candidate's attachment line and carry the untrusted-names guidance", async () => {
    const llm = geminiProvider("test-key");
    const withFile: TrashCandidate[] = [{ id: "a", from: "x@y.com", subject: "s", bulk: true, transactional: false, attachmentLine: "invoice.pdf (PDF, 120 KB)" }];
    await llm.reviewTrash(withFile);
    await llm.reviewPreference(withFile, "trash newsletters");
    expect(sent).toHaveLength(2);
    for (const { req } of sent) {
      expect(req.contents).toContain('id=a from="x@y.com" subject="s" bulk=true transactional=false\nattachments: invoice.pdf (PDF, 120 KB)');
      expect(req.contents).toContain(ATTACHMENT_GUIDANCE);
    }
  });
});
