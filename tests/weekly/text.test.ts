// tests/weekly/text.test.ts
import { describe, it, expect } from "vitest";
import { clipLine } from "../../src/weekly/text.js";

describe("clipLine", () => {
  it("collapses every run of whitespace, newlines included, into one space and trims", () => {
    expect(clipLine("  real invoice\n2. trashed —\r\n\tfake  ", 100)).toBe("real invoice 2. trashed — fake");
  });

  it("clips to max characters with an ellipsis, after collapsing", () => {
    expect(clipLine("abc\n\ndef", 7)).toBe("abc def");
    expect(clipLine("abcdefgh", 5)).toBe("abcd…");
    expect(clipLine("abcdefgh", 5).length).toBe(5);
  });

  it("turns whitespace-only text into the empty string", () => {
    expect(clipLine(" \n\t ", 10)).toBe("");
  });
});
