// tests/gmail/client.spam.test.ts
// The real client's Spam calls, against a mocked googleapis (what goes on the wire), plus
// the fake's Spam folder.
import { describe, it, expect, vi, beforeEach } from "vitest";

const api = vi.hoisted(() => ({
  list: [] as any[],
  batchModify: [] as any[],
  pool: [] as string[], // what "in:spam newer_than:7d" holds, newest first
  pageSize: 250,        // Gmail may return fewer than maxResults per page
}));

vi.mock("googleapis", () => ({
  google: {
    gmail: () => ({
      users: {
        messages: {
          async list(params: any) {
            api.list.push(params);
            const start = params.pageToken ? Number(params.pageToken) : 0;
            const n = Math.min(params.maxResults ?? 100, api.pageSize);
            const ids = api.pool.slice(start, start + n);
            const next = start + n < api.pool.length ? String(start + n) : undefined;
            return { data: { messages: ids.map(id => ({ id })), nextPageToken: next } };
          },
          async batchModify(params: any) { api.batchModify.push(params); return { data: {} }; },
        },
      },
    }),
  },
}));

const { googleGmailClient, fakeGmailClient } = await import("../../src/gmail/client.js");
const real = () => googleGmailClient({} as any);
const pool = (n: number) => Array.from({ length: n }, (_, i) => `m${i + 1}`);

describe("googleGmailClient.listSpam", () => {
  beforeEach(() => { api.list.length = 0; api.batchModify.length = 0; api.pool = []; api.pageSize = 250; });

  it("lists the last 7 days of Spam, asking for Spam explicitly", async () => {
    api.pool = pool(3);
    expect(await real().listSpam(301)).toEqual(["m1", "m2", "m3"]);
    expect(api.list).toHaveLength(1);
    expect(api.list[0]).toMatchObject({ userId: "me", q: "in:spam newer_than:7d", includeSpamTrash: true, maxResults: 301 });
  });

  it("pages until it has `max` ids, then stops", async () => {
    api.pool = pool(400);
    const ids = await real().listSpam(301);
    expect(ids).toHaveLength(301);
    expect(ids[300]).toBe("m301");
    expect(api.list.map(c => c.maxResults)).toEqual([301, 51]); // asks only for what's still missing
    expect(api.list[1].pageToken).toBe("250");
  });

  it("stops when Gmail has no more pages", async () => {
    api.pool = pool(260);
    expect(await real().listSpam(301)).toHaveLength(260);
    expect(api.list).toHaveLength(2);
  });

  it("asks for nothing when max is 0", async () => {
    api.pool = pool(5);
    expect(await real().listSpam(0)).toEqual([]);
    expect(api.list).toHaveLength(0);
  });
});

describe("fakeGmailClient spam folder", () => {
  it("lists the seeded Spam ids in order, capped at max", async () => {
    const g = fakeGmailClient({ historyId: "1", addedSince: {}, messages: {}, spam: ["s1", "s2", "s3"] });
    expect(await g.listSpam(10)).toEqual(["s1", "s2", "s3"]);
    expect(await g.listSpam(2)).toEqual(["s1", "s2"]);
  });

  it("has an empty Spam folder by default", async () => {
    expect(await fakeGmailClient({ historyId: "1", addedSince: {}, messages: {} }).listSpam(10)).toEqual([]);
  });
});

describe("googleGmailClient unspam / respam", () => {
  beforeEach(() => { api.batchModify.length = 0; });

  it("unspam takes mail out of Spam and into the inbox in one batchModify", async () => {
    await real().unspam(["a", "b"]);
    expect(api.batchModify).toEqual([{ userId: "me", requestBody: { ids: ["a", "b"], removeLabelIds: ["SPAM"], addLabelIds: ["INBOX"] } }]);
  });

  it("respam puts it back: into Spam and out of the inbox", async () => {
    await real().respam(["a"]);
    expect(api.batchModify).toEqual([{ userId: "me", requestBody: { ids: ["a"], addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] } }]);
  });

  it("makes no call for an empty id list", async () => {
    await real().unspam([]);
    await real().respam([]);
    expect(api.batchModify).toEqual([]);
  });
});

describe("fakeGmailClient unspam / respam", () => {
  it("unspam leaves the Spam folder; respam returns it; the folder listing follows", async () => {
    const g = fakeGmailClient({ historyId: "1", addedSince: {}, messages: {}, spam: ["s1", "s2"] });
    await g.unspam(["s1"]);
    expect(g.spammedIds!()).toEqual(["s2"]);
    expect(g.unspammedIds!()).toEqual(["s1"]);
    expect(await g.listSpam(10)).toEqual(["s2"]);
    await g.respam(["s1"]);
    expect(g.spammedIds!().sort()).toEqual(["s1", "s2"]);
    expect(g.unspammedIds!()).toEqual([]);
  });
});
