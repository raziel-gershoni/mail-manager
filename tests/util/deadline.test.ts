import { describe, it, expect } from "vitest";
import { beforeDeadline, TIMED_OUT } from "../../src/util/deadline.js";

const after = <T>(ms: number, v: T) => new Promise<T>(r => setTimeout(() => r(v), ms));

describe("beforeDeadline", () => {
  it("returns the call's value when it settles in time", async () => {
    expect(await beforeDeadline(after(5, "ok"), 1_000)).toBe("ok");
  });

  it("passes a rejection through when it comes in time", async () => {
    await expect(beforeDeadline(Promise.reject(new Error("boom")), 1_000)).rejects.toThrow("boom");
  });

  it("stops waiting once the deadline passes, and swallows the abandoned call's late rejection", async () => {
    const late = new Promise((_, reject) => setTimeout(() => reject(new Error("late")), 20));
    expect(await beforeDeadline(late, 5)).toBe(TIMED_OUT);
    await new Promise(r => setTimeout(r, 30)); // an unhandled rejection here would fail the run
  });

  it("a deadline already past times out at once", async () => {
    expect(await beforeDeadline(after(20, "slow"), -50)).toBe(TIMED_OUT);
  });

  it("an unbounded deadline waits for the call (clamped, not overflowed into an instant timeout)", async () => {
    expect(await beforeDeadline(after(10, "ok"), Number.POSITIVE_INFINITY)).toBe("ok");
  });
});
