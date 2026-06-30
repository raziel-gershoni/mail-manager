// tests/gmail/client.trash.test.ts
import { describe, it, expect } from "vitest";
import { fakeGmailClient } from "../../src/gmail/client.js";

describe("fakeGmailClient trash/untrash", () => {
  it("trash adds ids and untrash removes them", async () => {
    const g = fakeGmailClient({ historyId: "1", addedSince: {}, messages: {} });
    await g.trash(["a", "b"]);
    expect(g.trashedIds!().sort()).toEqual(["a", "b"]);
    await g.untrash(["a"]);
    expect(g.trashedIds!()).toEqual(["b"]);
  });
});
