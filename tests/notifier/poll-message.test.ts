import { describe, it, expect } from "vitest";
import { composePollMessage } from "../../src/notifier/brief.js";

describe("composePollMessage", () => {
  it("returns the brief alone when nothing was guarded-trashed", () => {
    expect(composePollMessage("your brief", 0)).toBe("your brief");
  });
  it("appends the guarded-trash notice to the brief", () => {
    const m = composePollMessage("your brief", 2)!;
    expect(m).toContain("your brief");
    expect(m).toMatch(/trashed 2 junk/i);
  });
  it("NEVER silent: zero important mail + a guarded trash still yields the notice", () => {
    const m = composePollMessage(null, 3);
    expect(m).toMatch(/trashed 3 junk/i);
  });
  it("returns null only when there is genuinely nothing to say", () => {
    expect(composePollMessage(null, 0)).toBeNull();
    expect(composePollMessage("   ", 0)).toBeNull();
  });
});
