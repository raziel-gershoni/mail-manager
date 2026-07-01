import { describe, it, expect } from "vitest";
import { searchParam } from "../../src/http/url.js";

describe("searchParam", () => {
  it("parses a param from a RELATIVE url (Vercel runtime shape)", () => {
    expect(searchParam("/api/oauth/start?key=abc", "key")).toBe("abc");
  });
  it("parses a param from an ABSOLUTE url too", () => {
    expect(searchParam("https://host.example/api/oauth/callback?code=xyz", "code")).toBe("xyz");
  });
  it("returns null when the param is absent", () => {
    expect(searchParam("/api/oauth/start", "key")).toBeNull();
  });
  it("handles multiple params", () => {
    expect(searchParam("/x?a=1&code=2&b=3", "code")).toBe("2");
  });
});
