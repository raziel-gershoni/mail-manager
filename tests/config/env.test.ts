// tests/config/env.test.ts
import { describe, it, expect } from "vitest";
import { loadEnv } from "../../src/config/env.js";

const valid = {
  DATABASE_URL: "postgres://x", TOKEN_ENC_KEY: "k", GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "sec", GOOGLE_REDIRECT_URI: "https://a/cb", GEMINI_API_KEY: "g",
  TELEGRAM_BOT_TOKEN: "t", TELEGRAM_OWNER_ID: "123", TELEGRAM_WEBHOOK_SECRET: "w",
  QSTASH_TOKEN: "q", QSTASH_CURRENT_SIGNING_KEY: "c", QSTASH_NEXT_SIGNING_KEY: "n",
  APP_BASE_URL: "https://a",
};

describe("loadEnv", () => {
  it("parses a valid environment and coerces owner id to number", () => {
    const env = loadEnv(valid);
    expect(env.TELEGRAM_OWNER_ID).toBe(123);
    expect(env.DATABASE_URL).toBe("postgres://x");
  });
  it("throws listing the missing variable", () => {
    const { DATABASE_URL, ...rest } = valid;
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/);
  });
});
