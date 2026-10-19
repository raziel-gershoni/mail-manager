// tests/db/schema.weekly.test.ts
import { describe, it, expect } from "vitest";
import * as schema from "../../src/db/schema.js";

describe("weekly_runs schema", () => {
  it("keys one row per user and kind, holding the week and when it was sent", () => {
    expect(schema).toHaveProperty("weeklyRuns");
    expect(Object.keys(schema.weeklyRuns as any)).toEqual(expect.arrayContaining(["userId", "kind", "week", "at"]));
  });
});
