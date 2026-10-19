// tests/db/schema.retro.test.ts
import { describe, it, expect } from "vitest";
import * as schema from "../../src/db/schema.js";

describe("retrospect schema (0018)", () => {
  it("poll_activity carries the Gmail message id and why (source)", () => {
    expect(Object.keys(schema.pollActivity as any)).toEqual(expect.arrayContaining(["messageId", "source"]));
  });
  it("memories has created_at next to updated_at", () => {
    expect(Object.keys(schema.memories as any)).toEqual(expect.arrayContaining(["createdAt", "updatedAt"]));
  });
});
