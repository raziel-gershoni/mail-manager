// tests/notifier/brief.test.ts
import { describe, it, expect } from "vitest";
import { generateBrief } from "../../src/notifier/brief.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { fakeAgentLLM } from "../../src/llm/provider.js";

describe("generateBrief", () => {
  const gmail = fakeGmailClient({
    historyId: "1", addedSince: {},
    messages: { a: { id: "a", threadId: "t", snippet: "s", payload: { headers: [{ name: "From", value: "stripe@x.com" }, { name: "Subject", value: "Invoice" }] } } },
    bodies: { a: "Amount due $420 by the 15th" },
  });
  it("returns null for no important mail", async () => {
    const llm = fakeAgentLLM(() => ({ kind: "final", text: "" }), () => "X");
    expect(await generateBrief([], { gmail, llm })).toBeNull();
  });
  it("summarizes the important bodies", async () => {
    const llm = fakeAgentLLM(() => ({ kind: "final", text: "" }), (emails) => `Brief: ${emails[0]!.subject} / ${emails[0]!.bodyText}`);
    const out = await generateBrief(["a"], { gmail, llm });
    expect(out).toContain("Invoice");
    expect(out).toContain("$420");
  });
  it("passes the current-date context to writeBrief", async () => {
    let seenContext: string | undefined;
    const llm = fakeAgentLLM(() => ({ kind: "final", text: "" }), (_emails, context) => { seenContext = context; return "B"; });
    await generateBrief(["a"], { gmail, llm, timezone: "UTC" });
    expect(seenContext).toContain("Today is");
    expect(seenContext).toContain("(UTC)");
  });
});
