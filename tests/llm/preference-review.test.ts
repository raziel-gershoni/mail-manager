// tests/llm/preference-review.test.ts
import { describe, it, expect } from "vitest";
import { renderPreferences } from "../../src/llm/gemini.js";
import { parseReviewJson } from "../../src/llm/provider.js";

describe("renderPreferences", () => {
  it("renders one line per preference with its key and action", () => {
    expect(renderPreferences([
      { slug: "global:lease", key: "lease", description: "flag anything about the lease", scope: "global", verdict: "important", action: null },
      { slug: "global:crypto", key: "crypto", description: "crypto pitches are noise", scope: "global", verdict: "unimportant", action: "trash" },
    ])).toBe("- [lease] flag anything about the lease -> important\n- [crypto] crypto pitches are noise -> unimportant, action=trash");
  });
  it("falls back to (none yet) when there are no preferences", () => {
    expect(renderPreferences([])).toBe("(none yet)");
  });
});

describe("parseReviewJson (reused by reviewPreference)", () => {
  it("keeps an id the model never judged, and keeps everything on a parse failure", () => {
    expect(parseReviewJson('[{"id":"a","keep":false,"reason":"junk"}]', ["a", "b"]))
      .toEqual([{ id: "a", keep: false, reason: "junk" }, { id: "b", keep: true, reason: "unjudged-rescue" }]);
    expect(parseReviewJson("not json", ["a"])).toEqual([{ id: "a", keep: true, reason: "parse-fail-rescue" }]);
  });
});
