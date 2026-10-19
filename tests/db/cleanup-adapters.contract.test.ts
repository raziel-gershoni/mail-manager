// tests/db/cleanup-adapters.contract.test.ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
const RUN = !!process.env.DATABASE_URL;
describe.skipIf(!RUN)("cleanup db adapters (integration)", () => {
  it("proposal create/get/confirm round-trips", async () => {
    const { dbProposalRepo } = await import("../../src/db/cleanup-adapters.js");
    const repo = dbProposalRepo();
    const p = await repo.create(1, ["a", "b"], "test");
    expect((await repo.get(1, p.id))?.messageIds).toEqual(["a", "b"]);
    await repo.markConfirmed(1, p.id);
    expect((await repo.get(1, p.id))?.status).toBe("confirmed");
  });
  it("action log record/lastUndoable/markUndone round-trips with newest-first + undone filter", async () => {
    const { dbActionLogRepo } = await import("../../src/db/cleanup-adapters.js");
    const repo = dbActionLogRepo();
    await repo.record(1, "runA", ["a"], "trash");
    await repo.record(1, "runB", ["b", "c"], "trash");
    expect((await repo.lastUndoable(1))?.runId).toBe("runB");   // newest first
    await repo.markUndone(1, "runB");
    expect((await repo.lastUndoable(1))?.runId).toBe("runA");   // undone filtered out
  });
  it("round-trips an unspam run, and markUndone stamps undone_at", async () => {
    const { dbActionLogRepo } = await import("../../src/db/cleanup-adapters.js");
    const { db, schema } = await import("../../src/db/client.js");
    const { and, eq } = await import("drizzle-orm");
    const repo = dbActionLogRepo();
    const runId = `unspam-${randomUUID()}`;
    await repo.record(1, runId, ["s1"], "unspam");
    expect(await repo.lastUndoable(1)).toEqual({ runId, messageIds: ["s1"], action: "unspam" });
    const before = Date.now();
    await repo.markUndone(1, runId);
    const [row] = await db().select({ undone: schema.actionLog.undone, undoneAt: schema.actionLog.undoneAt }).from(schema.actionLog)
      .where(and(eq(schema.actionLog.userId, 1), eq(schema.actionLog.runId, runId)));
    expect(row!.undone).toBe(true);
    expect(Math.abs(row!.undoneAt!.getTime() - before)).toBeLessThan(60_000);
  });
  it("action log runsSince returns runs made or undone at/after the date, with their times", async () => {
    const { dbActionLogRepo } = await import("../../src/db/cleanup-adapters.js");
    const repo = dbActionLogRepo();
    const from = new Date(Date.now() - 60_000); // margin for clock skew between Node and the DB
    const runId = `since-${randomUUID()}`;
    await repo.record(1, runId, ["x1", "x2"], "unspam");
    await repo.markUndone(1, runId);
    const mine = (await repo.runsSince(1, from)).find(r => r.runId === runId);
    expect(mine).toMatchObject({ messageIds: ["x1", "x2"], action: "unspam" });
    expect(mine!.at).toBeInstanceOf(Date);
    expect(mine!.undoneAt).toBeInstanceOf(Date);
  });
});
