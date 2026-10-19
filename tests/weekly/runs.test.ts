// tests/weekly/runs.test.ts
import { describe, it, expect } from "vitest";
import { fakeWeeklyRunRepo } from "../../src/weekly/runs.js";

describe("fakeWeeklyRunRepo", () => {
  it("has no key until one is set, then keeps it per user and kind", async () => {
    const runs = fakeWeeklyRunRepo();
    expect(await runs.get(1, "spam")).toBeNull();
    await runs.set(1, "spam", "2026-10-18");
    expect(await runs.get(1, "spam")).toBe("2026-10-18");
    expect(await runs.get(1, "retro")).toBeNull(); // other kind
    expect(await runs.get(2, "spam")).toBeNull();  // other user
  });

  it("overwrites the key when a later week is set", async () => {
    const runs = fakeWeeklyRunRepo();
    await runs.set(1, "spam", "2026-10-11");
    await runs.set(1, "spam", "2026-10-18");
    expect(await runs.get(1, "spam")).toBe("2026-10-18");
  });
});
