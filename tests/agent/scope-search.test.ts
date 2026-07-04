import { describe, it, expect } from "vitest";
import { scopeSearchToInbox } from "../../src/agent/tools.js";

describe("scopeSearchToInbox", () => {
  it("defaults a scope-less query to the inbox", () => {
    expect(scopeSearchToInbox("from:bank@x.com")).toBe("in:inbox from:bank@x.com");
    expect(scopeSearchToInbox("  invoice  ")).toBe("in:inbox invoice");
  });
  it("defaults an empty query to in:inbox", () => {
    expect(scopeSearchToInbox("")).toBe("in:inbox");
    expect(scopeSearchToInbox("   ")).toBe("in:inbox");
  });
  it("respects an explicit location scope and does NOT add in:inbox", () => {
    expect(scopeSearchToInbox("in:anywhere from:x@y.com")).toBe("in:anywhere from:x@y.com");
    expect(scopeSearchToInbox("in:trash foo")).toBe("in:trash foo");
    expect(scopeSearchToInbox("label:work bar")).toBe("label:work bar");
    expect(scopeSearchToInbox("from:x in:sent")).toBe("from:x in:sent");
  });
});
