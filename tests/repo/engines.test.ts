import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Vercel deploys package.json's engines.node. An open range such as ">=20" picks the newest
// major (26.x, whose built-in fetch switches to HTTP/2), so the runtime is pinned to one major.
describe("engines", () => {
  it("pins the Node runtime to the 24 line", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(pkg.engines.node).toBe("24.x");
  });
});
