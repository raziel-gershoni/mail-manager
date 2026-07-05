import { describe, it, expect } from "vitest";
import { composePollMessage } from "../../src/notifier/brief.js";

const act = (o: Partial<{ processed: number; surfaced: number; trashed: number; archived: number; unruled: string[] }>) =>
  ({ processed: 0, surfaced: 0, trashed: 0, archived: 0, unruled: [], ...o });

describe("composePollMessage", () => {
  it("sends a heartbeat when no mail arrived", () => {
    expect(composePollMessage(null, act({ processed: 0 }))).toBe("🟢 No new mail this check.");
  });
  it("reports a check-in when mail arrived but nothing was important", () => {
    expect(composePollMessage(null, act({ processed: 3 }))).toBe("📬 3 new · nothing important");
  });
  it("shows what it did (trash/archive) and the inbox split when it acted", () => {
    expect(composePollMessage(null, act({ processed: 8, trashed: 2 }))).toBe("📬 8 new · nothing important · trashed 2 · 6 left in inbox");
    expect(composePollMessage(null, act({ processed: 10, trashed: 2, archived: 1 }))).toBe("📬 10 new · nothing important · trashed 2 · archived 1 · 7 left in inbox");
  });
  it("appends a compact activity footer to an important brief", () => {
    expect(composePollMessage("your brief", act({ processed: 5, surfaced: 1, trashed: 2 }))).toBe("your brief\n\n_📬 5 new · trashed 2 · 2 left in inbox_");
  });
  it("brief with no guarded actions shows just the new count", () => {
    expect(composePollMessage("your brief", act({ processed: 2, surfaced: 2 }))).toBe("your brief\n\n_📬 2 new_");
  });
  it("flags un-ruled senders left in the inbox so the owner can teach a rule", () => {
    const m = composePollMessage(null, act({ processed: 1, unruled: ["Lee Amiga <leea@italent.co.il>"] }));
    expect(m).toContain("📬 1 new · nothing important");
    expect(m).toMatch(/New sender you haven't ruled: Lee Amiga <leea@italent\.co\.il>/);
    expect(m).toMatch(/keep\/archive\/trash/);
  });
  it("caps the un-ruled sender list and counts the overflow", () => {
    const m = composePollMessage(null, act({ processed: 8, unruled: ["a", "b", "c", "d", "e", "f", "g"] }));
    expect(m).toContain("a, b, c, d, e +2 more");
    expect(m).toMatch(/New senders you haven't ruled/); // plural
  });
});
