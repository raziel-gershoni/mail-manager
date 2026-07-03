import { describe, it, expect } from "vitest";
import { withIdempotency, fakeIdempotencyRepo } from "../../src/queue/idempotency.js";

describe("fakeIdempotencyRepo", () => {
  it("claim returns true the first time and false for the same id after", async () => {
    const repo = fakeIdempotencyRepo();
    expect(await repo.claim("u1")).toBe(true);
    expect(await repo.claim("u1")).toBe(false);
  });

  it("release then claim returns true again", async () => {
    const repo = fakeIdempotencyRepo();
    await repo.claim("u1");
    await repo.release("u1");
    expect(await repo.claim("u1")).toBe(true);
  });
});

describe("withIdempotency", () => {
  it("runs fn once for a given update id and returns processed:true with the result", async () => {
    const repo = fakeIdempotencyRepo();
    let calls = 0;
    const outcome = await withIdempotency("u1", repo, async () => {
      calls++;
      return "done";
    });
    expect(outcome).toEqual({ processed: true, result: "done" });
    expect(calls).toBe(1);
  });

  it("skips fn on a duplicate call with the same update id", async () => {
    const repo = fakeIdempotencyRepo();
    let calls = 0;
    const fn = async () => { calls++; return "done"; };
    await withIdempotency("u1", repo, fn);
    const second = await withIdempotency("u1", repo, fn);
    expect(second).toEqual({ processed: false });
    expect(calls).toBe(1);
  });

  it("releases the claim and rethrows when fn throws, allowing a subsequent retry to reclaim", async () => {
    const repo = fakeIdempotencyRepo();
    const boom = new Error("boom");
    await expect(withIdempotency("u1", repo, async () => { throw boom; })).rejects.toThrow(boom);
    expect(await repo.claim("u1")).toBe(true);
  });
});
