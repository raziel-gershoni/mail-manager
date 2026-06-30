import { describe, it, expect } from "vitest";
import { fakeProposalRepo, fakeActionLogRepo } from "../../src/cleanup/proposals.js";

describe("fakeProposalRepo", () => {
  it("creates, gets, and confirms a proposal", async () => {
    const r = fakeProposalRepo();
    const p = await r.create(1, ["a", "b"], "2 LinkedIn");
    expect(p.status).toBe("pending");
    expect((await r.get(1, p.id))?.messageIds).toEqual(["a", "b"]);
    await r.markConfirmed(1, p.id);
    expect((await r.get(1, p.id))?.status).toBe("confirmed");
    expect(await r.get(1, 999)).toBeNull();
  });
});

describe("fakeActionLogRepo", () => {
  it("records runs and returns the most recent undoable, then marks it undone", async () => {
    const r = fakeActionLogRepo();
    await r.record(1, "run1", ["a"]);
    await r.record(1, "run2", ["b", "c"]);
    expect((await r.lastUndoable(1))?.runId).toBe("run2");
    await r.markUndone(1, "run2");
    expect((await r.lastUndoable(1))?.runId).toBe("run1");  // run2 skipped
    await r.markUndone(1, "run1");
    expect(await r.lastUndoable(1)).toBeNull();
  });
});
