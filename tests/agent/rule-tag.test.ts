import { describe, it, expect } from "vitest";
import { ruleTag } from "../../src/agent/rule-tag.js";
import type { RuleMatch } from "../../src/memory/store.js";

const rm = (slug: string, action: RuleMatch["action"], verdict: RuleMatch["verdict"] = "unimportant"): RuleMatch => ({ slug, verdict, action });

describe("ruleTag", () => {
  it("maps each action to its kind and parses scope/matchValue from the slug", () => {
    expect(ruleTag(rm("domain:linkedin.com", "trash"))).toEqual({ kind: "auto-trash", scope: "domain", matchValue: "linkedin.com" });
    expect(ruleTag(rm("sender:jane@work.com", "archive"))).toEqual({ kind: "auto-archive", scope: "sender", matchValue: "jane@work.com" });
    expect(ruleTag(rm("domain:x.com", "review"))).toMatchObject({ kind: "guarded-trash" });
    expect(ruleTag(rm("domain:x.com", "review_archive"))).toMatchObject({ kind: "guarded-archive" });
    expect(ruleTag(rm("sender:a@b.com", "keep"))).toMatchObject({ kind: "keep" });
  });
  it("splits only on the FIRST colon, so a matchValue containing a colon is preserved", () => {
    expect(ruleTag(rm("sender:weird:value@x.com", "trash"))).toEqual({ kind: "auto-trash", scope: "sender", matchValue: "weird:value@x.com" });
  });
  it("maps a verdict-only rule (action null) by verdict", () => {
    expect(ruleTag(rm("sender:vip@x.com", null, "important"))).toMatchObject({ kind: "important" });
    expect(ruleTag(rm("domain:spam.com", null, "unimportant"))).toMatchObject({ kind: "ignore" });
  });
  it("returns null when there is no rule", () => {
    expect(ruleTag(null)).toBeNull();
  });
});
