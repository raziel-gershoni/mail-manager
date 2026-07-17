import { describe, it, expect } from "vitest";
import { classifyEmail } from "../../src/notifier/classify.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeLLM } from "../../src/llm/provider.js";
import { parseMessage } from "../../src/gmail/headers.js";

const email = parseMessage({ id: "a", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "x@y.com" }, { name: "Subject", value: "buy bitcoin" }] } });
function storeWith(action: "trash" | "archive" | null) {
  const s = inMemoryStore();
  s.upsertPreference({ key: "crypto", description: "crypto pitches are noise", verdict: "unimportant", action });
  s.confirmPreference("crypto");
  return s;
}

describe("classifyEmail preference resolution", () => {
  it("resolves a named key to its action FROM THE STORE (never from the model)", async () => {
    const out = await classifyEmail(email, { store: storeWith("trash"),
      llm: fakeLLM(() => ({ important: false, suspicious: false, reason: "r", matched: "crypto" })) });
    expect(out.matched).toEqual({ key: "crypto", action: "trash" });
  });

  it("ignores a key the model invented", async () => {
    const out = await classifyEmail(email, { store: storeWith("trash"),
      llm: fakeLLM(() => ({ important: false, suspicious: false, reason: "r", matched: "does-not-exist" })) });
    expect(out.matched).toBeNull();
  });

  it("an advisory-only preference (no action) yields no match to act on", async () => {
    const out = await classifyEmail(email, { store: storeWith(null),
      llm: fakeLLM(() => ({ important: false, suspicious: false, reason: "r", matched: "crypto" })) });
    expect(out.matched).toBeNull();
  });

  it("a sender rule short-circuits before any preference is considered", async () => {
    const s = storeWith("trash");
    s.upsertRule({ matchValue: "x@y.com", scope: "sender", verdict: "important", description: "x" });
    const out = await classifyEmail(email, { store: s, llm: fakeLLM(() => ({ important: false, suspicious: false, reason: "r", matched: "crypto" })) });
    expect(out.source).toBe("rule");
    expect(out.matched).toBeNull();
  });

  it("an LLM error falls back to important and never acts on a preference", async () => {
    const llm = { ...fakeLLM(() => ({ important: false, suspicious: false, reason: "" })), async classifyImportance() { throw new Error("boom"); } } as any;
    const out = await classifyEmail(email, { store: storeWith("trash"), llm });
    expect(out).toMatchObject({ important: true, suspicious: true, matched: null });
  });
});
