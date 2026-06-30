import { describe, it, expect } from "vitest";
import { buildAgentMessages, needsCompaction, compactState, COMPACT_TOKENS } from "../../src/context/assemble.js";

const memIdx = [{ slug: "g:lease", description: "flag anything about the lease", scope: "global" }];

describe("buildAgentMessages", () => {
  it("puts system + memory index + summary first, then window, then the new user text", () => {
    const state = { summary: "Earlier: discussed invoices.", window: [{ role: "assistant" as const, content: "Hi" }] };
    const msgs = buildAgentMessages("You are a secretary.", memIdx, state, "any news?");
    expect(msgs[0]?.role).toBe("system");
    expect(msgs[0]?.content).toContain("secretary");
    expect(msgs[0]?.content).toContain("lease");
    expect(msgs[0]?.content).toContain("discussed invoices");
    expect(msgs[1]).toEqual({ role: "assistant", content: "Hi" });
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "any news?" });
  });
});

describe("needsCompaction", () => {
  it("is false for a small window and true past the limit", () => {
    expect(needsCompaction({ summary: "", window: [{ role: "user", content: "hi" }] })).toBe(false);
    const big = { summary: "", window: [{ role: "user" as const, content: "x".repeat(COMPACT_TOKENS * 4 + 8) }] };
    expect(needsCompaction(big)).toBe(true);
  });
});

describe("compactState", () => {
  it("folds older turns into the summary and keeps the recent tail", async () => {
    const window = Array.from({ length: 12 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    const out = await compactState({ summary: "S0", window }, async (older, prev) => `${prev}+${older.length}`, 4);
    expect(out.window.length).toBe(4);
    expect(out.window[0]?.content).toBe("m8");
    expect(out.summary).toBe("S0+8");
  });
});
