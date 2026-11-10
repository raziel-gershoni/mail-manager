import { describe, it, expect, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { buildDestination, planPollSchedule, POLL_CRON, verifyQStash } from "../../src/queue/qstash.js";
import type { Env } from "../../src/config/env.js";

describe("buildDestination", () => {
  it("joins base url and path without double slashes", () => {
    expect(buildDestination("https://app.vercel.app/", "/api/worker")).toBe("https://app.vercel.app/api/worker");
    expect(buildDestination("https://app.vercel.app", "/api/worker")).toBe("https://app.vercel.app/api/worker");
  });
});

describe("POLL_CRON", () => {
  it("runs the inbox poll once an hour, on the hour", () => {
    expect(POLL_CRON).toBe("0 * * * *");
  });
});

describe("planPollSchedule", () => {
  const dest = "https://a/api/poll";
  const cron = "0 * * * *";
  const sched = (scheduleId: string, c: string, destination = dest) => ({ scheduleId, cron: c, destination });

  it("leaves a matching schedule alone", () => {
    expect(planPollSchedule([sched("s1", cron)], dest, cron)).toEqual({ kind: "ok", scheduleId: "s1" });
  });
  it("creates when there are no schedules", () => {
    expect(planPollSchedule([], dest, cron)).toEqual({ kind: "create" });
  });
  it("creates when no schedule matches the destination", () => {
    expect(planPollSchedule([sched("s1", cron, "https://a/api/other")], dest, cron)).toEqual({ kind: "create" });
  });
  it("replaces a schedule whose cron drifted from POLL_CRON", () => {
    // The whole point: editing POLL_CRON must actually reach an existing deployment.
    expect(planPollSchedule([sched("s1", "*/30 * * * *")], dest, cron)).toEqual({ kind: "replace", stale: ["s1"] });
  });
  it("replaces duplicates on one destination even when their cron is right", () => {
    expect(planPollSchedule([sched("s1", cron), sched("s2", cron)], dest, cron))
      .toEqual({ kind: "replace", stale: ["s1", "s2"] });
  });
  it("never touches schedules pointing elsewhere", () => {
    const plan = planPollSchedule([sched("other", "*/5 * * * *", "https://a/api/worker"), sched("s1", "*/30 * * * *")], dest, cron);
    expect(plan).toEqual({ kind: "replace", stale: ["s1"] });
  });
});

describe("verifyQStash", () => {
  const keys = { QSTASH_CURRENT_SIGNING_KEY: "test-current-key", QSTASH_NEXT_SIGNING_KEY: "test-next-key" } as Env;
  const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
  // A QStash-style signature: an HS256 JWT over the claims, with the body's SHA-256 inside.
  function sign(key: string, body: string): string {
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const claims = b64url(JSON.stringify({
      iss: "Upstash", sub: "https://app/api/worker", iat: now, nbf: now, exp: now + 300, jti: "t1",
      body: createHash("sha256").update(body).digest("base64url"),
    }));
    return `${head}.${claims}.${createHmac("sha256", key).update(`${head}.${claims}`).digest("base64url")}`;
  }
  const request = (signature: string, body: string) =>
    new Request("https://app/api/worker", { method: "POST", headers: { "upstash-signature": signature }, body });

  it("accepts a body signed with the configured key", async () => {
    const body = JSON.stringify({ update_id: 1 });
    await expect(verifyQStash(keys, request(sign("test-current-key", body), body))).resolves.toEqual({ update_id: 1 });
  });

  it("rejects a body signed with a different key", async () => {
    const body = "{}";
    await expect(verifyQStash(keys, request(sign("someone-elses-key", body), body))).rejects.toThrow();
  });

  it("verifies with the configured keys even when QSTASH_DEV is set", async () => {
    // Dev mode would verify against the signing keys published in the SDK instead.
    const previous = process.env.QSTASH_DEV;
    process.env.QSTASH_DEV = "true";
    try {
      const body = JSON.stringify({ update_id: 2 });
      await expect(verifyQStash(keys, request(sign("test-current-key", body), body))).resolves.toEqual({ update_id: 2 });
      await expect(verifyQStash(keys, request(sign("someone-elses-key", body), body))).rejects.toThrow();
    } finally {
      if (previous === undefined) delete process.env.QSTASH_DEV; else process.env.QSTASH_DEV = previous;
    }
  });
});
