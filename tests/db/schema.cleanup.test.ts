// tests/db/schema.cleanup.test.ts
import { describe, it, expect } from "vitest";
import * as schema from "../../src/db/schema.js";

describe("cleanup schema", () => {
  it("exposes proposals and actionLog tables", () => {
    expect(schema).toHaveProperty("proposals");
    expect(schema).toHaveProperty("actionLog");
  });
  it("proposals has status + messageIds, actionLog has runId + undone", () => {
    expect(Object.keys(schema.proposals as any)).toEqual(expect.arrayContaining(["userId","messageIds","summary","status"]));
    expect(Object.keys(schema.actionLog as any)).toEqual(expect.arrayContaining(["userId","runId","messageIds","undone"]));
  });
});
