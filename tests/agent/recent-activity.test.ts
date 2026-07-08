import { describe, it, expect } from "vitest";
import { readOnlyTools, dispatchTool, type ToolContext } from "../../src/agent/tools.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeActivityRepo } from "../../src/notifier/activity.js";

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: 1,
    gmail: fakeGmailClient({ historyId: "1", addedSince: {}, messages: {} }),
    memory: inMemoryStore(),
    ...over,
  };
}

describe("recent_activity tool", () => {
  it("returns the poll's recent activity (newest first, ISO timestamps)", async () => {
    const activity = fakeActivityRepo();
    await activity.record(1, [{ action: "trashed", from: "promo@shop.com", subject: "50% off" }]);
    await activity.record(1, [{ action: "flagged", from: "Lee <leea@italent.co.il>", subject: "" }]);

    const res = await dispatchTool("recent_activity", {}, ctx({ activity }), readOnlyTools()) as { items: Array<{ action: string; from: string; subject: string; at: string }> };
    expect(res.items.map(i => i.action)).toEqual(["flagged", "trashed"]); // newest first
    expect(res.items[0]!.from).toBe("Lee <leea@italent.co.il>");
    expect(typeof res.items[0]!.at).toBe("string"); // ISO timestamp
    expect(res.items[1]).toMatchObject({ action: "trashed", from: "promo@shop.com", subject: "50% off" });
  });
  it("honors the limit", async () => {
    const activity = fakeActivityRepo();
    await activity.record(1, [{ action: "trashed", from: "a@x.com", subject: "1" }, { action: "trashed", from: "b@x.com", subject: "2" }]);
    const res = await dispatchTool("recent_activity", { limit: 1 }, ctx({ activity }), readOnlyTools()) as { items: unknown[] };
    expect(res.items).toHaveLength(1);
  });
  it("returns nothing when no activity repo is wired", async () => {
    const res = await dispatchTool("recent_activity", {}, ctx(), readOnlyTools()) as { items: unknown[] };
    expect(res.items).toEqual([]);
  });
});
