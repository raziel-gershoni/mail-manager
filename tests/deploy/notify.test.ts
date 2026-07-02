import { describe, it, expect } from "vitest";
import { shouldNotifyDeploy, buildDeployMessage } from "../../src/deploy/notify.js";

describe("shouldNotifyDeploy", () => {
  it("is true only for production", () => {
    expect(shouldNotifyDeploy("production")).toBe(true);
    expect(shouldNotifyDeploy("preview")).toBe(false);
    expect(shouldNotifyDeploy("development")).toBe(false);
    expect(shouldNotifyDeploy(undefined)).toBe(false);
  });
});

describe("buildDeployMessage", () => {
  it("includes a short SHA when present", () => {
    expect(buildDeployMessage("abcdef1234567890")).toBe("🚀 mail-manager deployed (abcdef1).");
  });
  it("omits the SHA when absent", () => {
    expect(buildDeployMessage(undefined)).toBe("🚀 mail-manager deployed.");
    expect(buildDeployMessage("")).toBe("🚀 mail-manager deployed.");
  });
});
