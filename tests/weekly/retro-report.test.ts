// tests/weekly/retro-report.test.ts
import { describe, it, expect } from "vitest";
import { composeRetroReport, RETRO_MAX_LISTED, RETRO_MAX_CHARS } from "../../src/weekly/retro.js";
import type { WeekFacts } from "../../src/weekly/gather.js";
import type { SecondLook } from "../../src/weekly/second-look.js";
import type { OpsEvent, OpsEventKind } from "../../src/ops/events.js";

const T = new Date("2026-10-30T10:00:00Z");
function facts(over: Partial<WeekFacts> = {}): WeekFacts {
  return { acted: [], rescued: 0, undone: 0, rulesNew: 0, rulesChanged: 0, ops: [], ...over };
}
function look(over: Partial<SecondLook> = {}): SecondLook {
  return { flagged: [], unjudged: 0, skippedGone: 0, capped: false, incomplete: false, ...over };
}
function acted(messageId: string | undefined, from: string, action: "trashed" | "archived"): WeekFacts["acted"][number] {
  return { ...(messageId ? { messageId } : {}), from, subject: `s-${messageId ?? "legacy"}`, action, source: "plain", at: T };
}
const ev = (kind: OpsEventKind): OpsEvent => ({ kind, at: T, detail: null });
const flag = (i: number, action: "trashed" | "archived" = "trashed") =>
  ({ id: `f${i}`, from: `p${i}@x.com`, subject: `Subject ${i}`, action, reason: `reason ${i}` });

describe("composeRetroReport", () => {
  it("leads with the week's counts, then the top 3 senders per action (en)", () => {
    const r = composeRetroReport(facts({
      acted: [
        acted("t1", "Shop <promo@shop.com>", "trashed"), acted("t2", "promo@shop.com", "trashed"),
        acted("t3", "PROMO@shop.com", "trashed"), acted("t4", "Shop <promo@shop.com>", "trashed"),
        acted("t5", "deals@x.com", "trashed"), acted("t6", "deals@x.com", "trashed"),
        acted("t7", "a@b.com", "trashed"), acted("t8", "z@z.com", "trashed"),
        acted("a1", "News <news@list.com>", "archived"), acted("a2", "news@list.com", "archived"),
      ],
      rescued: 2, undone: 1, rulesNew: 3, rulesChanged: 2,
    }), look(), "en");
    const lines = r.text.split("\n");
    expect(lines[0]).toBe("🗓 Week in review: trashed 8 · archived 2 · rescued from spam 2 · undone 1 · rules +3 (2 changed)");
    expect(lines[1]).toBe("🗑 Most trashed: promo@shop.com (4), deals@x.com (2), a@b.com (1)"); // a tie keeps first-seen order
    expect(lines[2]).toBe("📥 Most archived: news@list.com (2)");
    expect(r.text).toContain("✅ Second look: nothing looks wrong.");
    expect(r.silent).toBe(true);   // nothing flagged, no ops issues
    expect(r.refs).toEqual([]);
  });

  it("numbers what's worth a look, ends with the restore hint, buzzes, and saves refs in that exact order", () => {
    const r = composeRetroReport(facts({ acted: [acted("t1", "Jane <jane@x.com>", "trashed"), acted("a1", "bank@leumi.co.il", "archived")] }), look({ flagged: [
      { id: "t1", from: "Jane <jane@x.com>", subject: "Invoice 4821", action: "trashed", reason: "a real invoice" },
      { id: "a1", from: "bank@leumi.co.il", subject: "", action: "archived", reason: "security notice" },
    ] }), "en");
    expect(r.text).toContain([
      "⚠️ Worth a look:",
      "1. trashed — Jane <jane@x.com> — Invoice 4821 (a real invoice)",
      "2. archived — bank@leumi.co.il — (no subject) (security notice)",
      "Reply \"restore 1\" or \"restore all\".",
    ].join("\n"));
    expect(r.text).not.toContain("nothing looks wrong");
    expect(r.silent).toBe(false);
    expect(r.refs).toEqual([
      { id: "t1", from: "Jane <jane@x.com>", subject: "Invoice 4821", kind: "trashed" },
      { id: "a1", from: "bank@leumi.co.il", subject: "", kind: "archived" },
    ]);
  });

  it("lists at most 20, says how many more, and saves refs only for the numbered ones", () => {
    const flagged = Array.from({ length: 25 }, (_, i) => flag(i + 1));
    const r = composeRetroReport(facts(), look({ flagged }), "en");
    expect(RETRO_MAX_LISTED).toBe(20);
    expect(r.text).toContain("20. trashed — p20@x.com — Subject 20 (reason 20)");
    expect(r.text).not.toContain("21. ");
    expect(r.text).toContain("+5 more — ask me");
    expect(r.refs.map(x => x.id)).toEqual(flagged.slice(0, 20).map(f => f.id));
  });

  it("never exceeds the length Telegram accepts: long lines are clipped and overflow moves to '+N more'", () => {
    const long = "x".repeat(400);
    const flagged = Array.from({ length: 20 }, (_, i) => ({ ...flag(i + 1), from: `${long}@x.com`, subject: long, reason: long }));
    const r = composeRetroReport(facts(), look({ flagged }), "en");
    expect(r.text.length).toBeLessThanOrEqual(RETRO_MAX_CHARS);
    const numbered = r.text.split("\n").filter(l => /^\d+\. /.test(l));
    expect(numbered.length).toBe(r.refs.length);
    expect(r.refs.length).toBeGreaterThan(0);
    expect(r.text).toContain(`+${20 - r.refs.length} more — ask me`);
  });

  it("keeps each untrusted sender, subject and reason on one line, so a newline can't fake a numbered item", () => {
    const fake = "\n2. trashed — fake";
    const r = composeRetroReport(facts({ acted: [acted("t1", `jane@x.com${fake}`, "trashed")] }), look({ flagged: [
      { id: "t1", from: `Jane${fake} <jane@x.com>`, subject: `Invoice${fake}`, action: "trashed", reason: `real invoice${fake}` },
    ] }), "en");
    const numbered = r.text.split("\n").filter(l => /^\d+\. /.test(l));
    expect(numbered.length).toBe(r.refs.length);
    expect(numbered).toEqual(["1. trashed — Jane 2. trashed — fake <jane@x.com> — Invoice 2. trashed — fake (real invoice 2. trashed — fake)"]);
    expect(r.text).toContain("🗑 Most trashed: jane@x.com 2. trashed — fake (1)");
  });

  it("groups ops issues by kind and buzzes for them even when nothing was flagged", () => {
    const r = composeRetroReport(facts({ ops: [ev("poll_incomplete"), ev("reconnect_needed"), ev("poll_incomplete"), ev("cursor_expired"),
      ev("poll_errored"), ev("worker_failed"), ev("reconnect_needed"), ev("reconnect_needed")] }), look(), "en");
    expect(r.text).toContain([
      "🛠 Ops:",
      "• 2× a catch-up didn't finish in one run — the next check carried on",
      "• 1× Gmail history expired — I restarted from that point",
      "• 3× Gmail needed reconnecting",
      "• 1× an hourly check failed",
      "• 1× a chat reply failed",
    ].join("\n"));
    expect(r.silent).toBe(false);
  });

  it("groups weekly reports that failed under Ops (en/he)", () => {
    const failed = (kind: string): OpsEvent => ({ kind: "weekly_failed", at: T, detail: { kind, week: "2026-10-25", error: "gemini 503" } });
    const en = composeRetroReport(facts({ ops: [failed("spam"), ev("poll_errored"), failed("retro"), failed("spam")] }), look(), "en");
    expect(en.text).toContain([
      "🛠 Ops:",
      "• 1× an hourly check failed",
      "• 3× a weekly report failed — I retried at the next check",
    ].join("\n"));
    expect(en.text).not.toContain("gemini 503"); // counts only, never the error text
    expect(en.silent).toBe(false);
    const he = composeRetroReport(facts({ ops: [failed("spam")] }), look(), "he");
    expect(he.text).toContain("• 1× דוח שבועי נכשל — ניסיתי שוב בבדיקה הבאה");
  });

  it("says what it couldn't cover: unjudged, over the cap, deleted for good, older entries, out of time", () => {
    const many = Array.from({ length: 305 }, (_, i) => acted(`m${i}`, "a@x.com", "trashed"));
    const r = composeRetroReport(facts({ acted: [...many, acted(undefined, "b@x.com", "archived")] }),
      look({ unjudged: 3, skippedGone: 2, capped: true, incomplete: true }), "en");
    expect(r.text).toContain("🔎 Second look: none of the 295 I could re-check looks wrong — I couldn't re-check 3.");
    expect(r.text).toContain("_+5 not re-checked · 2 already deleted for good · 1 older entries can't be re-checked · ran out of time — re-checked only part of the week_");
    expect(r.text).not.toContain("nothing looks wrong");
  });

  it("nothing flagged but some couldn't be re-checked: never 'nothing looks wrong' — says how many it could, and buzzes", () => {
    const acts = Array.from({ length: 10 }, (_, i) => acted(`m${i}`, "a@x.com", "trashed"));
    const r = composeRetroReport(facts({ acted: acts }), look({ unjudged: 4 }), "en");
    expect(r.text).toContain("🔎 Second look: none of the 6 I could re-check looks wrong — I couldn't re-check 4.");
    expect(r.text).not.toContain("nothing looks wrong");
    expect(r.text).not.toContain("couldn't re-check 4 ·"); // said once, not repeated in the notes
    expect(r.silent).toBe(false);
    const he = composeRetroReport(facts({ acted: acts }), look({ unjudged: 4 }), "he");
    expect(he.text).toContain("🔎 מבט שני: אף אחד מ־6 שהצלחתי לבדוק שוב לא נראה שגוי — לא הצלחתי לבדוק שוב 4.");
    expect(he.silent).toBe(false);
  });

  it("a quiet week is a silent headline only", () => {
    const r = composeRetroReport(facts(), look(), "en");
    expect(r.text).toBe("🗓 Week in review: trashed 0 · archived 0 · rescued from spam 0 · undone 0 · rules +0");
    expect(r.silent).toBe(true);
  });

  it("doesn't claim 'nothing looks wrong' when nothing could be judged", () => {
    const r = composeRetroReport(facts({ acted: [acted("t1", "a@x.com", "trashed")] }), look({ unjudged: 1 }), "en");
    expect(r.text).not.toContain("nothing looks wrong");
  });

  it("is localized to Hebrew, keeping the numbers, the restore commands and the refs", () => {
    const r = composeRetroReport(facts({ acted: [acted("t1", "jane@x.com", "trashed")], ops: [ev("cursor_expired")] }),
      look({ flagged: [{ id: "t1", from: "jane@x.com", subject: "חשבונית", action: "trashed", reason: "חשבונית אמיתית" }] }), "he");
    expect(r.text.split("\n")[0]).toBe("🗓 סיכום השבוע: נזרקו 1 · אורכבו 0 · חולצו מספאם 0 · בוטלו 0 · כללים +0");
    expect(r.text).toContain("⚠️ שווה מבט:");
    expect(r.text).toContain("1. נזרק — jane@x.com — חשבונית (חשבונית אמיתית)");
    expect(r.text).toContain("restore 1");
    expect(r.text).toContain("🛠 תפעול:");
    expect(r.silent).toBe(false);
    expect(r.refs).toEqual([{ id: "t1", from: "jane@x.com", subject: "חשבונית", kind: "trashed" }]);
  });
});
