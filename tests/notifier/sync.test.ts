import { describe, it, expect } from "vitest";
import { fakeSyncRepo, fakeSeenRepo } from "../../src/notifier/sync.js";

describe("fakeSyncRepo", () => {
  it("stores and returns the cursor", async () => {
    const s = fakeSyncRepo();
    expect(await s.get(1)).toBeNull();
    await s.set(1, "555");
    expect(await s.get(1)).toBe("555");
  });
});

describe("fakeSeenRepo", () => {
  it("dedupes and surfaces recent suspicious silenced items", async () => {
    const r = fakeSeenRepo();
    expect(await r.has(1, "a")).toBe(false);
    await r.record(1, { messageId: "a", surfaced: true, verdict: "important", reason: "" });
    await r.record(1, { messageId: "b", surfaced: false, verdict: "suspicious", reason: "borderline" });
    expect(await r.has(1, "a")).toBe(true);
    const sus = await r.recentSuspicious(1, 10);
    expect(sus.map(x => x.messageId)).toEqual(["b"]);
  });

  it("record updates an existing row in-place and does not duplicate it", async () => {
    const r = fakeSeenRepo();
    await r.record(1, { messageId: "a", surfaced: false, verdict: "suspicious", reason: "x" });
    // Second record call with same messageId — should update, not duplicate
    await r.record(1, { messageId: "a", surfaced: true, verdict: "important", reason: "y" });
    const row = await r.get(1, "a");
    expect(row).toEqual({ messageId: "a", surfaced: true, verdict: "important", reason: "y" });
    // Message is now surfaced=true so it no longer qualifies as recent suspicious
    const sus = await r.recentSuspicious(1, 10);
    expect(sus).toEqual([]);
  });

  it("get returns null for missing messageId and the exact recorded row", async () => {
    const r = fakeSeenRepo();
    expect(await r.get(1, "missing")).toBeNull();
    const row = { messageId: "m1", surfaced: false, verdict: "suspicious", reason: "test" };
    await r.record(1, row);
    expect(await r.get(1, "m1")).toEqual(row);
  });

  it("recentSuspicious returns most-recent-first and respects the limit cap", async () => {
    const r = fakeSeenRepo();
    await r.record(1, { messageId: "first",  surfaced: false, verdict: "suspicious", reason: "r1" });
    await r.record(1, { messageId: "second", surfaced: false, verdict: "suspicious", reason: "r2" });
    await r.record(1, { messageId: "third",  surfaced: false, verdict: "suspicious", reason: "r3" });
    // limit=2 should return the two most recent: "third" then "second"
    const sus = await r.recentSuspicious(1, 2);
    expect(sus.map(x => x.messageId)).toEqual(["third", "second"]);
  });

  it("recentSuspicious returns empty array when limit is 0", async () => {
    const r = fakeSeenRepo();
    await r.record(1, { messageId: "a", surfaced: false, verdict: "suspicious", reason: "r" });
    expect(await r.recentSuspicious(1, 0)).toEqual([]);
  });
});
