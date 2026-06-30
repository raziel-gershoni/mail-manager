import { describe, it, expect, vi } from "vitest";
import { buildDestination } from "../../src/queue/qstash.js";

describe("buildDestination", () => {
  it("joins base url and path without double slashes", () => {
    expect(buildDestination("https://app.vercel.app/", "/api/worker")).toBe("https://app.vercel.app/api/worker");
    expect(buildDestination("https://app.vercel.app", "/api/worker")).toBe("https://app.vercel.app/api/worker");
  });
});
