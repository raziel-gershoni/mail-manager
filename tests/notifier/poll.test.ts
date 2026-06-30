import { describe, it, expect } from "vitest";
import { runPoll } from "../../src/notifier/poll.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeLLM } from "../../src/llm/provider.js";
import { fakeSyncRepo, fakeSeenRepo } from "../../src/notifier/sync.js";

function deps(over: Partial<any> = {}) {
  return {
    userId: 1,
    gmail: fakeGmailClient({
      historyId: "200",
      addedSince: { "100": ["a","b"] },
      messages: {
        a: { id:"a", threadId:"t", snippet:"", payload:{ headers:[{name:"From",value:"jane@x.com"},{name:"Subject",value:"Lunch"}] } },
        b: { id:"b", threadId:"t", snippet:"", payload:{ headers:[{name:"From",value:"n@linkedin.com"},{name:"Subject",value:"You appeared in searches"}] } },
      },
    }),
    store: inMemoryStore(),
    llm: fakeLLM(i => ({ important: i.email.fromEmail === "jane@x.com", suspicious:false, reason:"x" })),
    sync: fakeSyncRepo(),
    seen: fakeSeenRepo(),
    ...over,
  };
}

describe("runPoll", () => {
  it("first run sets the cursor and notifies nothing", async () => {
    const d = deps();
    const r = await runPoll(d);
    expect(r.firstRun).toBe(true);
    expect(r.important).toEqual([]);
    expect(r.processed).toBe(0);
    expect(await d.sync.get(1)).toBe("200");   // cursor set to head history id
  });

  it("second run defers important commit until after delivery (at-least-once)", async () => {
    const d = deps();
    await d.sync.set(1, "100");
    const r = await runPoll(d);

    // returns only the important item
    expect(r.firstRun).toBe(false);
    expect(r.processed).toBe(2);
    expect(r.important.map((i: any) => i.messageId)).toEqual(["a"]);

    // BEFORE commit: important NOT yet seen, cursor NOT advanced...
    expect(await d.seen.has(1, "a")).toBe(false);
    expect(await d.sync.get(1)).toBe("100");
    // ...but the non-important message is already recorded as seen, not surfaced.
    expect(await d.seen.has(1, "b")).toBe(true);
    expect((await d.seen.get(1, "b"))?.surfaced).toBe(false);

    await r.commit();

    // AFTER commit: important is seen with surfaced true, cursor advanced to head.
    expect(await d.seen.has(1, "a")).toBe(true);
    const rowA = await d.seen.get(1, "a");
    expect(rowA?.surfaced).toBe(true);
    expect(rowA?.verdict).toBe("important");
    expect(await d.sync.get(1)).toBe("200");
  });

  it("skips messages already seen", async () => {
    const d = deps();
    await d.sync.set(1, "100");
    await d.seen.record(1, { messageId:"a", surfaced:true, verdict:"important", reason:"" });
    const r = await runPoll(d);
    expect(r.processed).toBe(1);                 // only b processed
    expect(r.important).toEqual([]);             // a was skipped, not re-surfaced
  });
});
