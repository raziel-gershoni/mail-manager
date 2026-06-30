import { describe, it, expect } from "vitest";
import { fakeConversationRepo } from "../../src/conversation/store.js";

describe("fakeConversationRepo", () => {
  it("starts empty and appends turns in order", async () => {
    const r = fakeConversationRepo();
    expect(await r.load(1)).toEqual({ summary: "", window: [] });
    await r.appendTurn(1, { role: "user", content: "hi" });
    await r.appendTurn(1, { role: "assistant", content: "hello", toolNote: "none" });
    const s = await r.load(1);
    expect(s.window.map(t => t.role)).toEqual(["user", "assistant"]);
    expect(s.window[1]?.toolNote).toBe("none");
  });
  it("replaceState overwrites summary and window", async () => {
    const r = fakeConversationRepo();
    await r.appendTurn(1, { role: "user", content: "x" });
    await r.replaceState(1, { summary: "older stuff", window: [{ role: "user", content: "y" }] });
    expect(await r.load(1)).toEqual({ summary: "older stuff", window: [{ role: "user", content: "y" }] });
  });
  it("defensive copy: mutating returned window does not corrupt stored state", async () => {
    const r = fakeConversationRepo();
    await r.appendTurn(1, { role: "user", content: "original" });
    const s1 = await r.load(1);
    s1.window[0]!.content = "mutated";
    const s2 = await r.load(1);
    expect(s2.window[0]?.content).toBe("original");
  });
  it("multi-user isolation: data appended to user 1 does not appear in user 2", async () => {
    const r = fakeConversationRepo();
    await r.appendTurn(1, { role: "user", content: "user1-data" });
    expect(await r.load(2)).toEqual({ summary: "", window: [] });
  });
});
