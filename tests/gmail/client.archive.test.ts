import { describe, it, expect } from "vitest";
import { fakeGmailClient } from "../../src/gmail/client.js";

const base = { historyId: "1", addedSince: {}, messages: {} };

describe("fake archive/unarchive", () => {
  it("archive removes from inbox, unarchive restores; archivedIds() reflects it", async () => {
    const c = fakeGmailClient(base);
    await c.archive(["a", "b"]);
    expect(c.archivedIds!().sort()).toEqual(["a", "b"]);
    await c.unarchive(["a"]);
    expect(c.archivedIds!()).toEqual(["b"]);
  });
  it("empty ids no-op", async () => {
    const c = fakeGmailClient(base);
    await c.archive([]); await c.unarchive([]);
    expect(c.archivedIds!()).toEqual([]);
  });
});
