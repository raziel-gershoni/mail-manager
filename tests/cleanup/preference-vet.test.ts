import { describe, it, expect } from "vitest";
import { preferenceVet } from "../../src/cleanup/preference-vet.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import type { LLMProvider } from "../../src/llm/provider.js";

const msg = (id: string, subject: string) => ({ id, threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "x@y.com" }, { name: "Subject", value: subject }] } });
function gmail() {
  return fakeGmailClient({
    historyId: "1", addedSince: {},
    messages: { a: msg("a", "buy bitcoin"), b: msg("b", "your invoice") },
    bodies: { a: "crypto crypto", b: "invoice attached" },
  });
}
function llm(fn: (c: any[], p: string) => any[]): LLMProvider {
  return { async classifyImportance() { return { important: true, suspicious: false, reason: "" }; },
    async agentStep() { return { kind: "final", text: "" }; }, async writeBrief() { return ""; },
    async reviewTrash() { throw new Error("preferenceVet must NOT use reviewTrash"); },
    async reviewPreference(c, p) { return fn(c as any[], p); } } as LLMProvider;
}

describe("preferenceVet", () => {
  it("acts only on bodies the LLM confirms match the preference, and passes the preference through", async () => {
    let seen = "";
    const r = await preferenceVet(["a", "b"], { gmail: gmail(), cap: 10, preference: "crypto pitches are noise",
      llm: llm((c, p) => { seen = p; return c.map(x => ({ id: x.id, keep: !x.bodyText.includes("crypto"), reason: "r" })); }) });
    expect(seen).toBe("crypto pitches are noise");
    expect(r.act).toEqual(["a"]);
    expect(r.keep.map(k => k.id)).toEqual(["b"]);
    expect(r.capped).toBe(false);
  });

  it("keeps on uncertainty: an unjudged id is never acted on", async () => {
    const r = await preferenceVet(["a", "b"], { gmail: gmail(), cap: 10, preference: "p",
      llm: llm(() => [{ id: "a", keep: false, reason: "match" }]) }); // b never judged
    expect(r.act).toEqual(["a"]);
    expect(r.keep.map(k => k.id)).toEqual(["b"]);
  });

  it("acts on a NON-bulk message (proves it does not reuse vetTrashSet's !bulk shortcut)", async () => {
    const r = await preferenceVet(["a"], { gmail: gmail(), cap: 10, preference: "p",
      llm: llm(c => c.map(x => ({ id: x.id, keep: false, reason: "match" }))) });
    expect(r.act).toEqual(["a"]); // vetTrashSet would have set this aside as "not bulk"
  });

  it("overflow beyond the cap is kept, never acted unread", async () => {
    const r = await preferenceVet(["a", "b"], { gmail: gmail(), cap: 1, preference: "p",
      llm: llm(c => c.map(x => ({ id: x.id, keep: false, reason: "match" }))) });
    expect(r.capped).toBe(true);
    expect(r.act).toEqual(["a"]);   // only the first was read+judged
    expect(r.act).not.toContain("b");
  });

  it("keeps on a malformed verdict: missing keep field, or a non-boolean keep value", async () => {
    const r = await preferenceVet(["a"], { gmail: gmail(), cap: 10, preference: "p",
      llm: llm(() => [{ id: "a" }]) }); // no `keep` field at all
    expect(r.act).toEqual([]);
    expect(r.keep.map(k => k.id)).toEqual(["a"]);

    const r2 = await preferenceVet(["a"], { gmail: gmail(), cap: 10, preference: "p",
      llm: llm(() => [{ id: "a", keep: "no" }]) }); // keep is not a boolean
    expect(r2.act).toEqual([]);
    expect(r2.keep.map(k => k.id)).toEqual(["a"]);
  });

  it("no ids is a no-op", async () => {
    expect(await preferenceVet([], { gmail: gmail(), cap: 10, preference: "p", llm: llm(() => []) }))
      .toEqual({ act: [], keep: [], capped: false });
  });
});
