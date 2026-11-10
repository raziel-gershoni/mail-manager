import { describe, it, expect } from "vitest";
import { DrizzleQueryError } from "drizzle-orm";
import { errorText, withoutQuery } from "../../src/util/errors.js";

describe("errorText", () => {
  it("gives the driver's message for a failed query, without the SQL or its params", () => {
    const cause = new Error('duplicate key value violates unique constraint "memories_pkey"');
    const err = new DrizzleQueryError('insert into "google_accounts" ("enc_refresh_token") values ($1)', ["v1.secret-cipher"], cause);
    const text = errorText(err);
    expect(text).toBe('duplicate key value violates unique constraint "memories_pkey"');
    expect(text).not.toContain("secret-cipher");
    expect(text).not.toContain("insert into");
  });
  it("says only that a query failed when the driver gave no cause", () => {
    const err = new DrizzleQueryError("select 1", ["p"]);
    expect(errorText(err)).toBe("database query failed");
  });
  it("passes other errors and thrown values through", () => {
    expect(errorText(new Error("boom"))).toBe("boom");
    expect(errorText("plain")).toBe("plain");
    expect(errorText(42)).toBe("42");
  });
});

describe("withoutQuery", () => {
  it("swaps a failed query for the driver's own error", () => {
    const cause = new Error("connection reset");
    expect(withoutQuery(new DrizzleQueryError("select $1", ["x"], cause))).toBe(cause);
  });
  it("leaves every other error as it is", () => {
    const e = new Error("other");
    expect(withoutQuery(e)).toBe(e);
  });
});
