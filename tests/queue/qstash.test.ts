import { describe, it, expect, vi } from "vitest";
import { buildDestination, pollScheduleExists } from "../../src/queue/qstash.js";

describe("buildDestination", () => {
  it("joins base url and path without double slashes", () => {
    expect(buildDestination("https://app.vercel.app/", "/api/worker")).toBe("https://app.vercel.app/api/worker");
    expect(buildDestination("https://app.vercel.app", "/api/worker")).toBe("https://app.vercel.app/api/worker");
  });
});

describe("pollScheduleExists", () => {
  it("returns true when a schedule with the destination exists", () => {
    expect(pollScheduleExists([{ destination: "https://a/api/poll" }], "https://a/api/poll")).toBe(true);
  });
  it("returns false when there are no schedules", () => {
    expect(pollScheduleExists([], "https://a/api/poll")).toBe(false);
  });
  it("returns false when no schedule matches the destination", () => {
    expect(pollScheduleExists([{ destination: "other" }], "https://a/api/poll")).toBe(false);
  });
});
