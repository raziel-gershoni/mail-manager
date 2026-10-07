// tests/llm/gemini-request.test.ts
// What geminiProvider actually puts on the wire, per method. Google is retiring the
// sampling params (temperature, topP, topK): once that lands, any request carrying
// one is rejected with a 400, which would take down classification, the agent, the
// brief and both reviewers at once. So every path is pinned here — both that no
// sampling param is sent, and that the rest of the config is exactly what it was.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClassifyInput, StreamSink, TrashCandidate } from "../../src/llm/provider.js";

const sent = vi.hoisted(() => [] as { method: string; req: any }[]);

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      async generateContent(req: any) {
        sent.push({ method: "generateContent", req });
        return { text: "[]", candidates: [] };
      },
      async generateContentStream(req: any) {
        sent.push({ method: "generateContentStream", req });
        return (async function* () { yield { candidates: [{ content: { parts: [{ text: "ok" }] } }] }; })();
      },
    };
  },
}));

const { geminiProvider } = await import("../../src/llm/gemini.js");

const SAMPLING = ["temperature", "topP", "topK"];

const classifyInput: ClassifyInput = {
  email: {
    id: "1", threadId: "1", from: "Acme <billing@acme.com>", fromEmail: "billing@acme.com",
    fromDomain: "acme.com", subject: "Invoice", snippet: "attached", date: new Date("2026-10-01T00:00:00Z"),
    headers: {}, labelIds: ["INBOX"],
  },
  risk: { bulk: false, hasListUnsubscribe: false, transactional: true },
  memoryIndex: [],
};
const candidates: TrashCandidate[] = [{ id: "a", from: "x@y.com", subject: "s", bulk: true, transactional: false }];
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
}

describe("geminiProvider request config", () => {
  beforeEach(() => { sent.length = 0; });

  it("never sends a sampling param (temperature/topP/topK) on any path", async () => {
    await exerciseEveryPath();
    expect(sent).toHaveLength(6); // every path above reached the SDK — none skipped
    for (const { req } of sent) {
      for (const key of SAMPLING) expect(req.config ?? {}).not.toHaveProperty(key);
    }
  });

  it("keeps the rest of each path's config unchanged", async () => {
    await exerciseEveryPath();
    const configs = sent.map(s => [s.method, s.req.config ?? {}]);
    const agentConfig = {
      systemInstruction: "SYS",
      tools: [{ functionDeclarations: [{ name: "get_time", description: "time", parameters: { type: "object", properties: {} } }] }],
    };
    expect(configs).toEqual([
      ["generateContent", { responseMimeType: "application/json" }], // classifyImportance
      ["generateContent", agentConfig],                               // agentStep
      ["generateContentStream", agentConfig],                         // agentStep, streamed
      ["generateContent", {}],                                        // writeBrief
      ["generateContent", { responseMimeType: "application/json" }], // reviewTrash
      ["generateContent", { responseMimeType: "application/json" }], // reviewPreference
    ]);
  });
});
