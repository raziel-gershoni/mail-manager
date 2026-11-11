import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// next.config.mjs customises webpack: extensionAlias maps the ".js" import specifiers to the ".ts"
// sources. Next 16 builds with Turbopack by default, which fails the build when a webpack() hook is
// present, and Turbopack has no extensionAlias yet (vercel/next.js#82945). So every next dev/build
// script opts back into webpack.
describe("build scripts", () => {
  it("run next dev and next build with --webpack", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    const runs = Object.values<string>(pkg.scripts).flatMap(s => s.match(/next (?:dev|build)[^&]*/g) ?? []);
    expect(runs.length).toBe(3); // dev, build, vercel-build
    for (const run of runs) expect(run).toContain("--webpack");
  });
});
