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
});
