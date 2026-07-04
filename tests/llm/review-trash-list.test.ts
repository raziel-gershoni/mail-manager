import { describe, it, expect } from "vitest";
import { reviewTrashList, REVIEW_BODY_CHARS } from "../../src/llm/gemini.js";
import type { TrashCandidate } from "../../src/llm/provider.js";

describe("reviewTrashList", () => {
  it("includes the body when present, marked untrusted", () => {
    const c: TrashCandidate = { id: "1", from: "a@b.com", subject: "Hi", bulk: true, transactional: false, bodyText: "Your invoice is attached" };
    const s = reviewTrashList([c]);
    expect(s).toContain("id=1");
    expect(s).toContain("Your invoice is attached");
    expect(s).toMatch(/UNTRUSTED/i);
  });
  it("omits the body line when absent — bulk-vet path is byte-for-byte unchanged", () => {
    const c: TrashCandidate = { id: "2", from: "a@b.com", subject: "Sale", bulk: true, transactional: false };
    expect(reviewTrashList([c])).toBe('id=2 from="a@b.com" subject="Sale" bulk=true transactional=false');
  });
  it("truncates a long body to the cap", () => {
    const c: TrashCandidate = { id: "3", from: "a@b.com", subject: "x", bulk: true, transactional: false, bodyText: "z".repeat(REVIEW_BODY_CHARS + 500) };
    const s = reviewTrashList([c]);
    expect(s).toContain("z".repeat(REVIEW_BODY_CHARS));
    expect(s).not.toContain("z".repeat(REVIEW_BODY_CHARS + 1));
  });
});
