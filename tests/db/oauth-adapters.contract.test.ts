import { describe, it, expect } from "vitest";
const RUN = !!process.env.DATABASE_URL;
describe.skipIf(!RUN)("oauth adapters (DB contract)", () => {
  it("oauth_states create → consume is one-time", async () => {
    const { dbOAuthStateRepo } = await import("../../src/db/oauth-state-adapter.js");
    const repo = dbOAuthStateRepo();
    const s = `st_${Math.floor(Date.now() % 1e9)}`;
    await repo.create(s, 1);
    expect(await repo.consume(s, new Date())).toBe(1);
    expect(await repo.consume(s, new Date())).toBeNull();
  });
  it("markNeedsReconnect transitions once then clear resets", async () => {
    const { dbGoogleAccountRepo } = await import("../../src/db/google-account-adapter.js");
    const repo = dbGoogleAccountRepo();
    await repo.clearNeedsReconnect(1);                 // baseline: false (requires a google_accounts row for user 1)
    expect(await repo.markNeedsReconnect(1)).toBe(true);
    expect(await repo.markNeedsReconnect(1)).toBe(false);
    await repo.clearNeedsReconnect(1);
  });
});
