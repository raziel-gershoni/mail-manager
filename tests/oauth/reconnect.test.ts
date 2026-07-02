import { describe, it, expect } from "vitest";
import {
  isInvalidGrant, isStateFresh, reconnectNudgeText, OAUTH_STATE_TTL_MS,
  fakeOAuthStateRepo, fakeGoogleAccountRepo,
} from "../../src/oauth/reconnect.js";

describe("isInvalidGrant", () => {
  it("detects invalid_grant across error shapes", () => {
    expect(isInvalidGrant({ message: "invalid_grant" })).toBe(true);
    expect(isInvalidGrant({ response: { data: { error: "invalid_grant" } } })).toBe(true);
    expect(isInvalidGrant({ message: "Error: invalid_grant (Token has been expired or revoked.)" })).toBe(true);
  });
  it("is false for unrelated errors", () => {
    expect(isInvalidGrant({ message: "network timeout" })).toBe(false);
    expect(isInvalidGrant(null)).toBe(false);
    expect(isInvalidGrant(new Error("rate limit"))).toBe(false);
  });
});

describe("isStateFresh", () => {
  it("is true within the TTL, false after", () => {
    const created = new Date("2026-07-02T12:00:00Z");
    expect(isStateFresh(created, new Date(created.getTime() + OAUTH_STATE_TTL_MS - 1))).toBe(true);
    expect(isStateFresh(created, new Date(created.getTime() + OAUTH_STATE_TTL_MS + 1))).toBe(false);
  });
});

describe("reconnectNudgeText", () => {
  it("includes the email when present", () => {
    expect(reconnectNudgeText("a@b.com")).toContain("a@b.com");
    expect(reconnectNudgeText()).not.toContain("(");
  });
});

describe("fakeOAuthStateRepo", () => {
  it("create then consume returns the userId once, then null (one-time use)", async () => {
    const repo = fakeOAuthStateRepo();
    const now = new Date("2026-07-02T12:00:00Z");
    await repo.create("s1", 7);
    expect(await repo.consume("s1", now)).toBe(7);
    expect(await repo.consume("s1", now)).toBeNull();           // already consumed
  });
  it("consume returns null for an expired state (and still deletes it)", async () => {
    const repo = fakeOAuthStateRepo();
    await repo.create("s2", 7, new Date("2026-07-02T12:00:00Z"));
    const late = new Date("2026-07-02T12:00:00Z").getTime() + OAUTH_STATE_TTL_MS + 1000;
    expect(await repo.consume("s2", new Date(late))).toBeNull();
    expect(await repo.consume("s2", new Date(late))).toBeNull(); // gone
  });
  it("consume returns null for an unknown state", async () => {
    expect(await fakeOAuthStateRepo().consume("nope", new Date())).toBeNull();
  });
});

describe("fakeGoogleAccountRepo", () => {
  it("markNeedsReconnect transitions false→true once (returns true), then false", async () => {
    const repo = fakeGoogleAccountRepo({ 1: false });
    expect(await repo.markNeedsReconnect(1)).toBe(true);   // newly set
    expect(await repo.markNeedsReconnect(1)).toBe(false);  // already set → no re-nudge
  });
  it("clearNeedsReconnect resets it", async () => {
    const repo = fakeGoogleAccountRepo({ 1: true });
    await repo.clearNeedsReconnect(1);
    expect(await repo.markNeedsReconnect(1)).toBe(true);   // was cleared, so transitions again
  });
});
