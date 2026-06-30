import { describe, it, expect } from "vitest";
import { classifyEmail } from "../../src/notifier/classify.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeLLM } from "../../src/llm/provider.js";
import { parseMessage } from "../../src/gmail/headers.js";

const email = (from: string, subject = "") =>
  parseMessage({ id:"m", threadId:"t", snippet:"", payload:{ headers:[
    { name:"From", value: from }, { name:"Subject", value: subject }]}});

describe("classifyEmail", () => {
  it("short-circuits on a sender rule without calling the LLM", async () => {
    const store = inMemoryStore();
    store.upsertSenderRule("n@linkedin.com", "unimportant");
    const llm = fakeLLM(() => { throw new Error("should not be called"); });
    const r = await classifyEmail(email("n@linkedin.com"), { store, llm });
    expect(r).toMatchObject({ important:false, source:"rule" });
  });
  it("delegates to the LLM when no rule matches", async () => {
    const store = inMemoryStore();
    const llm = fakeLLM(() => ({ important:true, suspicious:false, reason:"human" }));
    const r = await classifyEmail(email("jane@x.com","Lunch?"), { store, llm });
    expect(r).toMatchObject({ important:true, source:"llm", reason:"human" });
  });
  it("falls back to important+suspicious when the LLM throws", async () => {
    const store = inMemoryStore();
    const llm = fakeLLM(() => { throw new Error("boom"); });
    const r = await classifyEmail(email("a@b.com"), { store, llm });
    expect(r).toMatchObject({ important:true, suspicious:true, source:"llm" });
  });
});
