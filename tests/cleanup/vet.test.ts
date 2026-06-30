import { describe, it, expect } from "vitest";
import { vetTrashSet } from "../../src/cleanup/vet.js";
import { fakeReviewLLM } from "../../src/llm/provider.js";

const c = (id: string, over: Partial<any> = {}) => ({ id, from: `${id}@x.com`, subject: "s", bulk: true, transactional: false, ...over });

describe("vetTrashSet", () => {
  it("force-protects non-bulk and transactional candidates", async () => {
    const llm = fakeReviewLLM(() => []);
    const r = await vetTrashSet([c("a"), c("b", { bulk: false }), c("d", { transactional: true })], { llm });
    expect(r.autoTrash).toEqual(["a"]);
    expect(r.setAside.map(s => s.id).sort()).toEqual(["b", "d"]);
  });
  it("reviewer rescues an eligible candidate to set-aside", async () => {
    const llm = fakeReviewLLM(() => [{ id: "a", keep: true, reason: "looks personal" }]);
    const r = await vetTrashSet([c("a"), c("e")], { llm });
    expect(r.autoTrash).toEqual(["e"]);
    expect(r.setAside.find(s => s.id === "a")?.reason).toMatch(/personal/);
  });
  it("caps the auto-trash set and sets capped", async () => {
    const llm = fakeReviewLLM(() => []);
    const many = Array.from({ length: 5 }, (_, i) => c(`m${i}`));
    const r = await vetTrashSet(many, { llm, cap: 2 });
    expect(r.autoTrash).toHaveLength(2);
    expect(r.capped).toBe(true);
    expect(r.setAside).toHaveLength(3);
  });
});
