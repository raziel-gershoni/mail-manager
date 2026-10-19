// tests/db/schema.ops.test.ts
import { describe, it, expect } from "vitest";
import * as schema from "../../src/db/schema.js";

describe("ops_events schema", () => {
  it("exposes opsEvents with user, kind, detail and time", () => {
    expect(schema).toHaveProperty("opsEvents");
    expect(Object.keys(schema.opsEvents as any)).toEqual(expect.arrayContaining(["id", "userId", "kind", "detail", "at"]));
  });
});
