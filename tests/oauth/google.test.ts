// tests/oauth/google.test.ts
import { describe, it, expect } from "vitest";
import { buildAuthUrl } from "../../src/oauth/google.js";

const env: any = {
  GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec",
  GOOGLE_REDIRECT_URI: "https://app/api/oauth/callback",
};

describe("buildAuthUrl", () => {
  it("requests offline access, consent, and the gmail.modify scope", () => {
    const url = new URL(buildAuthUrl(env, "state123"));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("gmail.modify");
    expect(url.searchParams.get("state")).toBe("state123");
    expect(url.searchParams.get("client_id")).toBe("cid");
  });
});
