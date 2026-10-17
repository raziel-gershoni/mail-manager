import { describe, it, expect } from "vitest";
import { composePollMessage, pollSilent } from "../../src/notifier/brief.js";

const act = (o: Partial<{ processed: number; surfaced: number; trashed: number; archived: number; unruled: string[]; remaining: number; cursorExpired: boolean }>) =>
  ({ processed: 0, surfaced: 0, trashed: 0, archived: 0, unruled: [], remaining: 0, cursorExpired: false, ...o });

describe("composePollMessage", () => {
  it("sends a heartbeat when no mail arrived", () => {
    expect(composePollMessage(null, act({ processed: 0 }), "en")).toBe("🟢 No new mail this check.");
  });
  it("renders the heartbeat in Hebrew", () => {
    expect(composePollMessage(null, act({ processed: 0 }), "he")).toBe("🟢 אין דואר חדש בבדיקה הזו.");
  });
  it("reports a check-in when mail arrived but nothing was important", () => {
    expect(composePollMessage(null, act({ processed: 3 }), "en")).toBe("📬 3 new · nothing important");
  });
  it("shows what it did (trash/archive) and the inbox split when it acted", () => {
    expect(composePollMessage(null, act({ processed: 8, trashed: 2 }), "en")).toBe("📬 8 new · nothing important · trashed 2 · 6 left in inbox");
    expect(composePollMessage(null, act({ processed: 10, trashed: 2, archived: 1 }), "en")).toBe("📬 10 new · nothing important · trashed 2 · archived 1 · 7 left in inbox");
  });
  it("localizes the activity report in Hebrew", () => {
    expect(composePollMessage(null, act({ processed: 8, trashed: 2 }), "he")).toBe("📬 8 חדשים · שום דבר חשוב · נזרקו 2 · 6 נשארו בתיבה");
  });
  it("appends a compact activity footer to an important brief", () => {
    expect(composePollMessage("your brief", act({ processed: 5, surfaced: 1, trashed: 2 }), "en")).toBe("your brief\n\n_📬 5 new · trashed 2 · 2 left in inbox_");
  });
  it("brief with no guarded actions shows just the new count", () => {
    expect(composePollMessage("your brief", act({ processed: 2, surfaced: 2 }), "en")).toBe("your brief\n\n_📬 2 new_");
  });
  it("flags un-ruled senders left in the inbox so the owner can teach a rule", () => {
    const m = composePollMessage(null, act({ processed: 1, unruled: ["Lee Amiga <leea@italent.co.il>"] }), "en");
    expect(m).toContain("📬 1 new · nothing important");
    expect(m).toMatch(/New sender you haven't ruled: Lee Amiga <leea@italent\.co\.il>/);
    expect(m).toMatch(/keep\/archive\/trash/);
  });
  it("caps the un-ruled sender list and counts the overflow", () => {
    const m = composePollMessage(null, act({ processed: 8, unruled: ["a", "b", "c", "d", "e", "f", "g"] }), "en");
    expect(m).toContain("a, b, c, d, e +2 more");
    expect(m).toMatch(/New senders you haven't ruled/); // plural
  });
});

describe("composePollMessage — catch-up that couldn't finish", () => {
  const WARN_EN = "⚠️ I haven't got to about 23 more emails yet — I'll keep going next hour. Check Gmail if you don't want to wait.";
  const WARN_HE = "⚠️ עוד לא הגעתי לכ־23 מיילים נוספים — אמשיך בשעה הבאה. אפשר לבדוק ישירות ב־Gmail אם לא רוצים לחכות.";
  it("ends the brief with the warning", () => {
    expect(composePollMessage("your brief", act({ processed: 5, surfaced: 1, remaining: 23 }), "en"))
      .toBe(`your brief\n\n_📬 5 new_\n${WARN_EN}`);
  });
  it("ends a nothing-important report with the warning", () => {
    expect(composePollMessage(null, act({ processed: 3, remaining: 23 }), "en"))
      .toBe(`📬 3 new · nothing important\n${WARN_EN}`);
  });
  it("puts the warning after the un-ruled senders line", () => {
    const out = composePollMessage(null, act({ processed: 3, unruled: ["a@x.com"], remaining: 23 }), "en");
    expect(out.split("\n").at(-1)).toBe(WARN_EN);
  });
  it("sends only the warning, not the heartbeat, when nothing was covered", () => {
    expect(composePollMessage(null, act({ processed: 0, remaining: 23 }), "en")).toBe(WARN_EN);
  });
  it("localizes the warning in Hebrew", () => {
    expect(composePollMessage(null, act({ processed: 0, remaining: 23 }), "he")).toBe(WARN_HE);
  });
});

describe("composePollMessage — expired history cursor", () => {
  const EXPIRED_EN = "⚠️ I lost track of your mail since my last check — Gmail no longer keeps that much history. I've restarted from now, so please look through Gmail for anything that came in before this.";
  const EXPIRED_HE = "⚠️ איבדתי מעקב אחרי הדואר מאז הבדיקה האחרונה — Gmail כבר לא שומר היסטוריה כל כך ארוכה. התחלתי מחדש מעכשיו, אז כדאי לעבור ב־Gmail על מה שהגיע לפני כן.";
  it("sends the restart notice instead of the heartbeat", () => {
    expect(composePollMessage(null, act({ cursorExpired: true }), "en")).toBe(EXPIRED_EN);
  });
  it("localizes the restart notice in Hebrew", () => {
    expect(composePollMessage(null, act({ cursorExpired: true }), "he")).toBe(EXPIRED_HE);
  });
});

describe("pollSilent", () => {
  it("is silent only for a routine report that finished", () => {
    expect(pollSilent(false, 0, false)).toBe(true);
    expect(pollSilent(true, 0, false)).toBe(false);
    expect(pollSilent(false, 4, false)).toBe(false); // an unfinished catch-up always buzzes
    expect(pollSilent(true, 4, false)).toBe(false);
    expect(pollSilent(false, 0, true)).toBe(false);  // so does a restart after an expired cursor
    expect(pollSilent(true, 0, true)).toBe(false);
    expect(pollSilent(false, 4, true)).toBe(false);
    expect(pollSilent(true, 4, true)).toBe(false);
  });
});
