// tests/http/worker-route.test.ts
// An error that escapes the worker is logged by Next itself. It must leave without the SQL and
// params drizzle puts in its message, yet stay a throw so QStash still sees a 500 and retries.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DrizzleQueryError } from "drizzle-orm";

const claim = vi.fn();

vi.mock("../../src/config/env.js", () => ({ env: () => ({ TELEGRAM_OWNER_ID: 1, OWNER_TZ: "UTC" }) }));
vi.mock("../../src/queue/qstash.js", () => ({
  verifyQStash: async () => ({ update_id: 77, message: { from: { id: 1 }, chat: { id: 5 }, text: "hello" } }),
}));
vi.mock("../../src/users/identity.js", () => ({ resolveUserForTelegram: async () => 1 }));
vi.mock("../../src/db/user-adapters.js", () => ({ dbTelegramLinkRepo: () => ({}), dbUserDirectory: () => ({}) }));
vi.mock("../../src/db/idempotency-adapter.js", () => ({
  dbIdempotencyRepo: () => ({ claim, release: async () => {}, complete: async () => {} }),
}));

const { POST } = await import("../../app/api/worker/route.js");

const req = () => new Request("https://app/api/worker", { method: "POST", body: "{}" });

describe("worker route", () => {
  beforeEach(() => { claim.mockReset(); vi.spyOn(console, "log").mockImplementation(() => {}); });

  it("rethrows a failed query as the driver's own error, without its SQL or params", async () => {
    const cause = new Error("connection reset by peer");
    claim.mockRejectedValue(new DrizzleQueryError('insert into "idempotency" ("key") values ($1)', ["secret-param"], cause));
    const err = await POST(req()).then(() => null, (e: unknown) => e);
    expect(err).toBe(cause); // still a throw: QStash gets a 500 and retries
    expect(String((err as Error).message)).not.toContain("insert into");
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain("secret-param");
  });

  it("rethrows other errors unchanged", async () => {
    const boom = new Error("boom");
    claim.mockRejectedValue(boom);
    await expect(POST(req())).rejects.toBe(boom);
  });
});
