import { describe, it, expect } from "vitest";
import { briefEmailBlock, BRIEF_SIGN_GUIDANCE } from "../../src/llm/gemini.js";
import type { BriefEmail } from "../../src/llm/provider.js";

describe("briefEmailBlock", () => {
  it("renders a ruled email's kind + a null-rule email as 'rule: none', preserving fields", () => {
    const block = briefEmailBlock([
      { from: "news@list.com", subject: "Weekly", bodyText: "hi", rule: { kind: "guarded-archive", scope: "domain", matchValue: "list.com" } },
      { from: "jane@x.com", subject: "Lunch", bodyText: "yo" },
    ] satisfies BriefEmail[]);
    expect(block).toContain("rule: guarded-archive (domain list.com)");
    expect(block).toContain("rule: none");
    expect(block).toContain("Subject: Weekly");
    expect(block).toContain("UNTRUSTED");
  });
});

describe("BRIEF_SIGN_GUIDANCE", () => {
  it("carries the stacked guarded signs and the no-mark contract", () => {
    for (const sign of ["🗑", "📥", "🛡🗑", "🛡📥", "✅", "⭐", "🔕"]) expect(BRIEF_SIGN_GUIDANCE).toContain(sign);
    expect(BRIEF_SIGN_GUIDANCE).toMatch(/rule: none/i);
  });
});
