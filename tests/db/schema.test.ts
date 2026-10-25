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
  it("user_settings has the weekly schedule, and no longer names the old hours and days", () => {
    const cols = Object.keys(schema.userSettings as any);
    expect(cols).toContain("schedule");
    // 0020 drops these columns while this code is live, so it must never name them.
    for (const c of ["digestStartHour", "digestEndHour", "activeDays"]) expect(cols).not.toContain(c);
  });

});
