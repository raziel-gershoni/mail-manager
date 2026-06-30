// tests/db/schema.test.ts
import { describe, it, expect } from "vitest";
import * as schema from "../../src/db/schema.js";

describe("schema", () => {
  it("exposes the foundation tables", () => {
    for (const t of ["users","googleAccounts","telegramLinks","memories","seenMessages","syncState"]) {
      expect(schema, `missing table ${t}`).toHaveProperty(t);
    }
  });
  it("memories has rule fast-path columns", () => {
    const cols = Object.keys((schema.memories as any));
    for (const c of ["matchType","matchValue","verdict"]) expect(cols).toContain(c);
  });
});
