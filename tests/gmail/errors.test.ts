import { describe, it, expect } from "vitest";
import { isNotFound } from "../../src/gmail/errors.js";

describe("isNotFound", () => {
  it("matches the googleapis 404 shape (numeric code + status)", () => {
    // Shape observed in production: `{ status: 404, code: 404, message: "Requested entity was not found." }`
    expect(isNotFound({ status: 404, code: 404, message: "Requested entity was not found." })).toBe(true);
  });
  it("matches a string code and a nested response status", () => {
    expect(isNotFound({ code: "404" })).toBe(true);
    expect(isNotFound({ response: { status: 404 } })).toBe(true);
  });
  it("does not match other errors", () => {
    expect(isNotFound(new Error("boom"))).toBe(false);
    expect(isNotFound({ code: 500, status: 500 })).toBe(false);
    expect(isNotFound({ code: "invalid_grant" })).toBe(false);
    expect(isNotFound(null)).toBe(false);
    expect(isNotFound("nope")).toBe(false);
  });
});
