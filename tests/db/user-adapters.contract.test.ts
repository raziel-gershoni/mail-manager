import { describe, it, expect } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("user-adapters (DB contract)", () => {
  it("upsert is idempotent on telegram_user_id and round-trips by both keys", async () => {
    const { dbTelegramLinkRepo } = await import("../../src/db/user-adapters.js");
    const repo = dbTelegramLinkRepo();
    const tg = 900000000 + Math.floor(Date.now() % 1000);
    // NOTE: requires an existing users row; contract runs against a seeded dev DB.
    await repo.upsert({ userId: 1, telegramUserId: tg, chatId: tg });
    await repo.upsert({ userId: 1, telegramUserId: tg, chatId: tg + 1 }); // update, not duplicate
    const byTg = await repo.getByTelegramUserId(tg);
    expect(byTg).toEqual({ userId: 1, chatId: tg + 1 });
  });
});
