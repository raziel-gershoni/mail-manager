import { describe, it, expect } from "vitest";
const RUN = !!process.env.DATABASE_URL;
describe.skipIf(!RUN)("dbConversationRepo (integration)", () => {
  it("round-trips a turn", async () => {
    const { dbConversationRepo } = await import("../../src/db/conversation-adapter.js");
    const repo = dbConversationRepo();
    await repo.appendTurn(1, { role: "user", content: "hello" });
    const s = await repo.load(1);
    expect(s.window.at(-1)?.content).toBe("hello");
  });
});
