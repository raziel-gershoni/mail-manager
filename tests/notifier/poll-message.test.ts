import { describe, it, expect } from "vitest";
import { composePollMessage } from "../../src/notifier/brief.js";

describe("composePollMessage", () => {
  it("returns the brief alone when nothing was guarded-acted", () => {
    expect(composePollMessage("your brief", 0, 0)).toBe("your brief");
  });
  it("appends the guarded-trash notice to the brief", () => {
    const m = composePollMessage("your brief", 2, 0)!;
    expect(m).toContain("your brief");
    expect(m).toMatch(/trashed 2 junk/i);
  });
  it("appends the guarded-archive notice to the brief", () => {
    const m = composePollMessage("your brief", 0, 3)!;
    expect(m).toContain("your brief");
    expect(m).toMatch(/archived 3 routine/i);
  });
  it("reports both trashed and archived in one notice", () => {
    const m = composePollMessage(null, 2, 3)!;
    expect(m).toMatch(/trashed 2 junk/i);
    expect(m).toMatch(/archived 3 routine/i);
  });
  it("NEVER silent: zero important mail + a guarded archive still yields the notice", () => {
    expect(composePollMessage(null, 0, 4)).toMatch(/archived 4 routine/i);
  });
  it("returns null only when there is genuinely nothing to say", () => {
    expect(composePollMessage(null, 0, 0)).toBeNull();
    expect(composePollMessage("   ", 0, 0)).toBeNull();
  });
});
