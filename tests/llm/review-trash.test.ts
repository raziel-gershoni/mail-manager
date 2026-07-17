// tests/llm/review-trash.test.ts
import { describe, it, expect } from "vitest";
import { parseReviewJson, fakeReviewLLM } from "../../src/llm/provider.js";

describe("parseReviewJson", () => {
  it("maps verdicts by id; an unjudged (omitted) id fails safe to keep, only explicit keep:false trashes", () => {
    const out = parseReviewJson('[{"id":"a","keep":true,"reason":"looks personal"},{"id":"c","keep":false,"reason":"junk"}]', ["a", "b", "c"]);
    expect(out.find(v => v.id === "a")).toEqual({ id: "a", keep: true, reason: "looks personal" });
    expect(out.find(v => v.id === "b")).toEqual({ id: "b", keep: true, reason: "unjudged-rescue" }); // omitted → kept, never trashed unjudged
    expect(out.find(v => v.id === "c")).toEqual({ id: "c", keep: false, reason: "junk" });           // explicit trash respected
  });
  it("on non-JSON, fails safe by keeping (rescuing) every candidate", () => {
    const out = parseReviewJson("garbage", ["a", "b"]);
    expect(out.every(v => v.keep)).toBe(true);
  });

  // Keep-on-uncertainty applies to MALFORMED verdicts too, not just missing ones: a
  // judged id whose `keep` isn't literally false is an ambiguous verdict, and only an
  // explicit keep:false may act. This path is shared by reviewTrash (guarded senders)
  // and reviewPreference (standing preferences) — a false keep is harmless, a false
  // trash loses mail.
  it("keeps a judged id whose keep is malformed, absent, or null — only explicit false acts", () => {
    expect(parseReviewJson('[{"id":"a","keep":"yes","reason":"junk"}]', ["a"]))
      .toEqual([{ id: "a", keep: true, reason: "junk" }]);        // non-boolean → keep
    expect(parseReviewJson('[{"id":"a","reason":"junk"}]', ["a"]))
      .toEqual([{ id: "a", keep: true, reason: "junk" }]);        // key omitted → keep
    expect(parseReviewJson('[{"id":"a","keep":null,"reason":"junk"}]', ["a"]))
      .toEqual([{ id: "a", keep: true, reason: "junk" }]);        // null → keep
    expect(parseReviewJson('[{"id":"a","keep":0,"reason":"junk"}]', ["a"]))
      .toEqual([{ id: "a", keep: true, reason: "junk" }]);        // falsy-but-not-false → keep
    expect(parseReviewJson('[{"id":"a","keep":false,"reason":"junk"}]', ["a"]))
      .toEqual([{ id: "a", keep: false, reason: "junk" }]);       // explicit false → act
  });
});

describe("fakeReviewLLM", () => {
  it("scripts verdicts", async () => {
    const llm = fakeReviewLLM(() => [{ id: "x", keep: true, reason: "r" }]);
    expect(await llm.reviewTrash([{ id: "x", from: "a", subject: "s", bulk: true, transactional: false }]))
      .toEqual([{ id: "x", keep: true, reason: "r" }]);
  });
});
