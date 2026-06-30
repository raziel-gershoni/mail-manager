// tests/llm/review-trash.test.ts
import { describe, it, expect } from "vitest";
import { parseReviewJson, fakeReviewLLM } from "../../src/llm/provider.js";

describe("parseReviewJson", () => {
  it("maps verdicts by id and defaults missing ids to keep=false", () => {
    const out = parseReviewJson('[{"id":"a","keep":true,"reason":"looks personal"}]', ["a", "b"]);
    expect(out.find(v => v.id === "a")).toEqual({ id: "a", keep: true, reason: "looks personal" });
    expect(out.find(v => v.id === "b")).toEqual({ id: "b", keep: false, reason: "" });
  });
  it("on non-JSON, fails safe by keeping (rescuing) every candidate", () => {
    const out = parseReviewJson("garbage", ["a", "b"]);
    expect(out.every(v => v.keep)).toBe(true);
  });
});

describe("fakeReviewLLM", () => {
  it("scripts verdicts", async () => {
    const llm = fakeReviewLLM(() => [{ id: "x", keep: true, reason: "r" }]);
    expect(await llm.reviewTrash([{ id: "x", from: "a", subject: "s", bulk: true, transactional: false }]))
      .toEqual([{ id: "x", keep: true, reason: "r" }]);
  });
});
