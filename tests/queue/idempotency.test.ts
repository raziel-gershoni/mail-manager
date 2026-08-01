import { describe, it, expect } from "vitest";
import { withIdempotency, fakeIdempotencyRepo, CLAIM_STALE_MS } from "../../src/queue/idempotency.js";

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

// When Vercel KILLS the function at the 60s cap, no catch runs and no `finally`
// runs — the claim just sits there. Before this, the QStash retry saw a live claim,
// returned 200, and the owner's message was never answered and never retried.
describe("stale claims (the killed-function hole)", () => {
  it("rejects a retry that lands while the first attempt is still running", async () => {
    let t = 0;
    const repo = fakeIdempotencyRepo([], { now: () => t });
    expect(await repo.claim("u1")).toBe(true);
    t += CLAIM_STALE_MS - 1;
    expect(await repo.claim("u1")).toBe(false); // genuine duplicate delivery
  });

  it("reclaims once the claim is older than any function could live", async () => {
    let t = 0;
    const repo = fakeIdempotencyRepo([], { now: () => t });
    expect(await repo.claim("u1")).toBe(true);
    t += CLAIM_STALE_MS + 1;
    expect(await repo.claim("u1")).toBe(true); // the first attempt is provably dead
  });

  it("NEVER reclaims a completed turn, however old — that would re-answer and re-act", async () => {
    let t = 0;
    const repo = fakeIdempotencyRepo([], { now: () => t });
    await withIdempotency("u1", repo, async () => "answered");
    t += CLAIM_STALE_MS * 100;
    expect(await repo.claim("u1")).toBe(false);
  });

  it("marks the turn complete only after fn succeeds", async () => {
    let t = 0;
    const repo = fakeIdempotencyRepo([], { now: () => t });
    await expect(withIdempotency("u1", repo, async () => { throw new Error("died"); })).rejects.toThrow();
    t += CLAIM_STALE_MS * 100;
    expect(await repo.claim("u1")).toBe(true); // a failed turn stays retryable
  });
});
