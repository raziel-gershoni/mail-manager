import { describe, it, expect } from "vitest";
import { logMeta, logPreview } from "../../src/util/log.js";

describe("logMeta", () => {
  it("projects id/from/subject and truncates the snippet — never a full body", () => {
    const m = logMeta({ id: "1", from: "a@b.com", subject: "Hi", snippet: "x".repeat(500) });
    expect(m).toMatchObject({ id: "1", from: "a@b.com", subject: "Hi" });
    expect((m.snippet as string).length).toBeLessThanOrEqual(200);
    expect(m).not.toHaveProperty("bodyText");
  });
  it("omits snippet when there isn't one", () => {
    expect(logMeta({ id: "1", from: "a", subject: "s" })).not.toHaveProperty("snippet");
  });
});

describe("logPreview", () => {
  it("truncates long text with an ellipsis and leaves short text alone", () => {
    expect(logPreview("abcdef", 3)).toBe("abc…");
    expect(logPreview("ab", 3)).toBe("ab");
  });
});
