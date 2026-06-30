// tests/db/schema.conversation.test.ts
import { describe, it, expect } from "vitest";
import * as schema from "../../src/db/schema.js";

describe("conversation schema", () => {
  it("exposes conversations and messages tables", () => {
    expect(schema).toHaveProperty("conversations");
    expect(schema).toHaveProperty("messages");
  });
  it("messages has role/content/toolNote columns", () => {
    const cols = Object.keys(schema.messages as any);
    for (const c of ["userId","role","content","toolNote"]) expect(cols).toContain(c);
  });
});
