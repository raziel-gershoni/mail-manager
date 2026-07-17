// tests/memory/store.preferences.test.ts
import { describe, it, expect } from "vitest";
import { inMemoryStore } from "../../src/memory/store.js";

describe("standing preferences in the store", () => {
  it("upsertPreference writes an inert pending row that reaches NO prompt", () => {
    const s = inMemoryStore();
    const row = s.upsertPreference({ key: "crypto", description: "crypto pitches are noise", verdict: "unimportant", action: "trash" });
    expect(row).toMatchObject({ slug: "global:crypto", scope: "global", matchType: null, matchValue: null, pending: true });
    expect(s.index()).toEqual([]); // pending ⇒ excluded from the injected block
  });

  it("confirmPreference activates it, and index() then exposes key/verdict/action", () => {
    const s = inMemoryStore();
    s.upsertPreference({ key: "crypto", description: "crypto pitches are noise", verdict: "unimportant", action: "trash" });
    expect(s.confirmPreference("crypto")).toMatchObject({ pending: false });
    expect(s.index()).toEqual([
      { slug: "global:crypto", key: "crypto", description: "crypto pitches are noise", scope: "global", verdict: "unimportant", action: "trash" },
    ]);
  });

  it("confirmPreference returns null for an unknown key", () => {
    expect(inMemoryStore().confirmPreference("nope")).toBeNull();
  });

  it("re-teaching an existing preference makes it pending again (an edit must be re-approved)", () => {
    const s = inMemoryStore();
    s.upsertPreference({ key: "crypto", description: "a", verdict: "unimportant" });
    s.confirmPreference("crypto");
    s.upsertPreference({ key: "crypto", description: "b", verdict: "unimportant", action: "trash" });
    expect(s.list().length).toBe(1);           // updated in place, no duplicate
    expect(s.index()).toEqual([]);             // inert again until re-confirmed
  });

  // THE safety invariant: a preference must never deterministically decide a message.
  it("a preference is NEVER matched by findRuleFor, whatever the sender", () => {
    const s = inMemoryStore();
    s.upsertPreference({ key: "crypto", description: "crypto pitches are noise", verdict: "unimportant", action: "trash" });
    s.confirmPreference("crypto");
    expect(s.findRuleFor("anyone@anywhere.com", "anywhere.com")).toBeNull();
  });

  it("deleteBySlug removes a preference in either state", () => {
    const s = inMemoryStore();
    s.upsertPreference({ key: "crypto", description: "x", verdict: "unimportant" });
    s.deleteBySlug("global:crypto");
    expect(s.list()).toEqual([]);
  });
});
