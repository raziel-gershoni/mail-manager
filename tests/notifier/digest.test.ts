import { describe, it, expect } from "vitest";
import { buildImportantDigest, buildReviewDigest } from "../../src/notifier/digest.js";

const items = [
  { messageId:"a1", from:"Jane <jane@x.com>", subject:"Lunch?", reason:"from a person" },
  { messageId:"b2", from:"Stripe <no-reply@stripe.com>", subject:"Invoice", reason:"transactional" },
];

describe("buildImportantDigest", () => {
  it("returns null for an empty list", () => {
    expect(buildImportantDigest([])).toBeNull();
  });
  it("renders one row + a Not important button per item", () => {
    const msg = buildImportantDigest(items)!;
    expect(msg.text).toContain("Lunch?");
    expect(msg.text).toContain("Invoice");
    expect(msg.buttons).toHaveLength(2);
    expect(msg.buttons[0]![0]).toEqual({ text: "🗑 Not important", callbackData: "ni:a1" });
    expect(msg.buttons[1]![0]!.callbackData).toBe("ni:b2");
  });
});

describe("buildReviewDigest", () => {
  it("uses Actually important buttons", () => {
    const msg = buildReviewDigest([items[0]!])!;
    expect(msg.buttons[0]![0]).toEqual({ text: "⭐ Actually important", callbackData: "ai:a1" });
  });
});
