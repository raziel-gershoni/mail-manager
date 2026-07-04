import { describe, it, expect } from "vitest";
import { guardVet } from "../../src/cleanup/guard.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { fakeReviewLLM, type TrashCandidate } from "../../src/llm/provider.js";

function gmail() {
  return fakeGmailClient({
    historyId: "1", addedSince: {},
    messages: {
      // both bulk (List-Unsubscribe) → go to the LLM reviewer
      junk: { id: "junk", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "promo@shop.com" }, { name: "Subject", value: "50% off" }, { name: "List-Unsubscribe", value: "<x>" }] } },
      keep: { id: "keep", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "promo@shop.com" }, { name: "Subject", value: "newsletter" }, { name: "List-Unsubscribe", value: "<x>" }] } },
      // no List-Unsubscribe → non-bulk → set aside (kept) without the LLM
      personal: { id: "personal", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "jane@x.com" }, { name: "Subject", value: "lunch?" }] } },
    },
    bodies: { junk: "buy now", keep: "your invoice #123 is attached", personal: "hey" },
  });
}

// keep iff the body mentions an invoice — this also proves guardVet threads the
// full bodyText into the candidate the reviewer sees.
const llm = fakeReviewLLM((cands: TrashCandidate[]) =>
  cands.map(c => ({ id: c.id, keep: (c.bodyText ?? "").includes("invoice"), reason: (c.bodyText ?? "").includes("invoice") ? "invoice" : "junk" })));

describe("guardVet", () => {
  it("trashes junk, keeps the body-important and the non-bulk ones", async () => {
    const r = await guardVet(["junk", "keep", "personal"], { gmail: gmail(), llm, cap: 10 });
    expect(r.trash).toEqual(["junk"]);
    expect(r.keep.map(k => k.id).sort()).toEqual(["keep", "personal"]);
    expect(r.keep.find(k => k.id === "keep")?.reason).toContain("invoice");
    expect(r.capped).toBe(false);
  });
  it("caps body reads and reports capped when there are more than the cap", async () => {
    const r = await guardVet(["junk", "keep", "personal"], { gmail: gmail(), llm, cap: 2 });
    expect(r.capped).toBe(true);
    expect([...r.trash, ...r.keep.map(k => k.id)].sort()).toEqual(["junk", "keep"]); // only first 2 processed
  });
  it("returns empty for no ids", async () => {
    const r = await guardVet([], { gmail: gmail(), llm, cap: 10 });
    expect(r).toEqual({ trash: [], keep: [], capped: false });
  });
});
