import { describe, it, expect } from "vitest";
import { isSetupAuthorized } from "../../src/setup/auth.js";

describe("isSetupAuthorized", () => {
  it("returns true when provided matches expected", () => {
    expect(isSetupAuthorized("s", "s")).toBe(true);
  });
  it("returns false when provided does not match expected", () => {
    expect(isSetupAuthorized("x", "s")).toBe(false);
  });
  it("returns false when provided is null", () => {
    expect(isSetupAuthorized(null, "s")).toBe(false);
  });
  it("returns false when provided is empty", () => {
    expect(isSetupAuthorized("", "s")).toBe(false);
  });
});
