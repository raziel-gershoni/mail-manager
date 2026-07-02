import { describe, it, expect } from "vitest";
import { inMemoryStore } from "../../src/memory/store.js";

describe("MemoryStore.findRuleFor", () => {
  it("returns null when no rule matches", () => {
    const s = inMemoryStore();
    expect(s.findRuleFor("a@x.com", "x.com")).toBeNull();
  });
  it("prefers an exact sender rule over a domain rule", () => {
    const s = inMemoryStore();
    s.upsertSenderRule("ceo@acme.com", "important");
    const dom = s.list(); // sanity
    expect(dom.length).toBe(1);
    expect(s.findRuleFor("ceo@acme.com", "acme.com")).toEqual({ slug: "sender:ceo@acme.com", verdict: "important", action: null });
  });
  it("upsert updates verdict in place (no duplicate)", () => {
    const s = inMemoryStore();
    s.upsertSenderRule("n@linkedin.com", "unimportant");
    s.upsertSenderRule("n@linkedin.com", "important");
    expect(s.list().length).toBe(1);
    expect(s.findRuleFor("n@linkedin.com", "linkedin.com")?.verdict).toBe("important");
  });
  it("index returns only global/freeform memories for the LLM", () => {
    const s = inMemoryStore([
      { userId:1, slug:"global:newsletters", description:"weekly newsletters are noise",
        body:"", scope:"global", matchType:null, matchValue:null, verdict:null, action:null },
    ]);
    s.upsertSenderRule("n@linkedin.com", "unimportant");
    expect(s.index().map(e => e.slug)).toEqual(["global:newsletters"]);
  });
});

describe("action on rules", () => {
  it("upsertRule stores an action and findRuleFor returns it", () => {
    const s = inMemoryStore();
    s.upsertRule({ matchValue: "linkedin.com", scope: "domain", verdict: "unimportant", description: "LinkedIn", action: "trash" });
    const m = s.findRuleFor("x@linkedin.com", "linkedin.com");
    expect(m).toMatchObject({ verdict: "unimportant", action: "trash" });
  });
  it("action defaults to null when omitted", () => {
    const s = inMemoryStore();
    s.upsertRule({ matchValue: "dana@x.com", scope: "sender", verdict: "important", description: "Dana" });
    expect(s.findRuleFor("dana@x.com", "x.com")?.action ?? null).toBeNull();
  });
});
