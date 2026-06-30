import { describe, it, expect } from "vitest";
import { fakeAgentLLM } from "../../src/llm/provider.js";

describe("fakeAgentLLM", () => {
  it("scripts agent steps and a brief", async () => {
    const llm = fakeAgentLLM(
      (msgs) => msgs.length < 3
        ? { kind: "tool_calls", calls: [{ name: "search_gmail", args: { query: "from:linkedin.com" } }] }
        : { kind: "final", text: "Found 2." },
      (emails) => `Brief of ${emails.length}.`,
    );
    const step = await llm.agentStep([{ role: "user", content: "x" }], []);
    expect(step).toEqual({ kind: "tool_calls", calls: [{ name: "search_gmail", args: { query: "from:linkedin.com" } }] });
    expect(await llm.writeBrief([{ from: "a", subject: "b", bodyText: "c" }])).toBe("Brief of 1.");
  });
});
