import { describe, it, expect } from "vitest";
import { bucketByAction } from "../../src/cleanup/apply-rules.js";

describe("bucketByAction", () => {
  it("buckets by rule action; groups un-ruled by sender", () => {
    const out = bucketByAction([
      { id: "1", from: "LinkedIn <no-reply@linkedin.com>", subject: "You appeared", action: "trash" },
      { id: "2", from: "Substack <x@substack.com>", subject: "Weekly", action: "archive" },
      { id: "3", from: "Medium <m@medium.com>", subject: "Today", action: null },
      { id: "4", from: "Medium <m@medium.com>", subject: "Daily", action: null },
    ], 200);
    expect(out.trash).toEqual(["1"]);
    expect(out.archive).toEqual(["2"]);
    expect(out.undecided).toEqual([{ from: "Medium <m@medium.com>", subject: "Today", ids: ["3", "4"] }]);
    expect(out.capped).toBe(false);
  });
  it("caps total acted (archive+trash) and marks capped", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: String(i), from: "a@b.com", subject: "s", action: "trash" as const }));
    const out = bucketByAction(items, 3);
    expect(out.trash.length).toBe(3);
    expect(out.capped).toBe(true);
  });
});
