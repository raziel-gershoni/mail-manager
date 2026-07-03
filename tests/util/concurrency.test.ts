import { describe, it, expect } from "vitest";
import { mapLimit } from "../../src/util/concurrency.js";

describe("mapLimit", () => {
  it("preserves input order", async () => {
    const result = await mapLimit([1, 2, 3], 2, async x => x * 10);
    expect(result).toEqual([10, 20, 30]);
  });

  it("never exceeds the concurrency limit and processes all items", async () => {
    let inFlight = 0;
    let max = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    const result = await mapLimit(items, 3, async x => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise(resolve => setTimeout(resolve, 0));
      inFlight--;
      return x;
    });
    expect(max).toBeLessThanOrEqual(3);
    expect(result).toEqual(items);
  });

  it("runs all in parallel when limit >= items.length", async () => {
    let inFlight = 0;
    let max = 0;
    const items = [1, 2, 3, 4];
    const result = await mapLimit(items, 10, async x => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise(resolve => setTimeout(resolve, 0));
      inFlight--;
      return x * 2;
    });
    expect(max).toBe(4);
    expect(result).toEqual([2, 4, 6, 8]);
  });

  it("returns an empty array for an empty input", async () => {
    const result = await mapLimit([] as number[], 5, async x => x);
    expect(result).toEqual([]);
  });
});
