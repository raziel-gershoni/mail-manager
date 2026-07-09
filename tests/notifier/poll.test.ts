import { describe, it, expect } from "vitest";
import { runPoll } from "../../src/notifier/poll.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeLLM } from "../../src/llm/provider.js";
import { fakeActionLogRepo } from "../../src/cleanup/proposals.js";
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
    actionLog: fakeActionLogRepo(),
    ...over,
  };
}

// A poll scenario with a guarded (action:"review") rule for shop.com: two bulk
// messages from that sender (one junk, one that reads important) plus a normal
// important message. reviewTrash keeps iff the body mentions an invoice.
function guardedDeps() {
  const store = inMemoryStore();
  store.upsertRule({ matchValue: "shop.com", scope: "domain", verdict: "unimportant", description: "shop", action: "review" });
  return {
    userId: 1,
    store,
    gmail: fakeGmailClient({
      historyId: "200",
      addedSince: { "100": ["gjunk", "gkeep", "jane"] },
      messages: {
        gjunk: { id: "gjunk", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "promo@shop.com" }, { name: "Subject", value: "50% off" }, { name: "List-Unsubscribe", value: "<x>" }] } },
        gkeep: { id: "gkeep", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "promo@shop.com" }, { name: "Subject", value: "newsletter" }, { name: "List-Unsubscribe", value: "<x>" }] } },
        jane: { id: "jane", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "jane@x.com" }, { name: "Subject", value: "Lunch" }] } },
      },
      bodies: { gjunk: "buy now", gkeep: "your invoice is attached", jane: "hi" },
    }),
    llm: {
      async classifyImportance(i: any) { return { important: i.email.fromEmail === "jane@x.com", suspicious: false, reason: "x" }; },
      async agentStep() { return { kind: "final", text: "" }; },
      async writeBrief() { return ""; },
      async reviewTrash(cands: any[]) { return cands.map(c => ({ id: c.id, keep: (c.bodyText ?? "").includes("invoice"), reason: "r" })); },
    } as any,
    sync: fakeSyncRepo(),
    seen: fakeSeenRepo(),
    actionLog: fakeActionLogRepo(),
  };
}

// A poll scenario with a PLAIN (unguarded) trash rule for shop.com. The message
// body reads "important" — so if the plain path wrongly went through guardVet
// (whose fake reviewTrash keeps everything here), it would be KEPT. Asserting it
// is trashed proves the plain path acts outright with no body-read.
function plainTrashDeps(action: "trash" | "archive" = "trash") {
  const store = inMemoryStore();
  store.upsertRule({ matchValue: "shop.com", scope: "domain", verdict: "unimportant", description: "shop", action });
  return {
    userId: 1, store,
    gmail: fakeGmailClient({
      historyId: "200",
      addedSince: { "100": ["p1", "jane"] },
      messages: {
        p1: { id: "p1", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "promo@shop.com" }, { name: "Subject", value: "sale" }] } },
        jane: { id: "jane", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "jane@x.com" }, { name: "Subject", value: "Lunch" }] } },
      },
      bodies: { p1: "your invoice is attached — very important", jane: "hi" },
    }),
    llm: {
      async classifyImportance(i: any) { return { important: i.email.fromEmail === "jane@x.com", suspicious: false, reason: "x" }; },
      async agentStep() { return { kind: "final", text: "" }; },
      async writeBrief() { return ""; },
      async reviewTrash(cands: any[]) { return cands.map(c => ({ id: c.id, keep: true, reason: "would-keep" })); }, // guardVet WOULD keep everything
    } as any,
    sync: fakeSyncRepo(), seen: fakeSeenRepo(), actionLog: fakeActionLogRepo(),
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

  it("collects un-ruled unimportant senders (left in inbox) for the report", async () => {
    const d = deps(); // a=jane@x.com (important, surfaced), b=n@linkedin.com (unimportant, no rule → un-ruled)
    await d.sync.set(1, "100");
    const r = await runPoll(d);
    expect(r.unruled).toEqual(["n@linkedin.com"]); // only the un-ruled sender left in the inbox; the important one is surfaced, not flagged
  });

  it("skips a message that 404s (deleted after history listed) instead of aborting, and still advances the cursor", async () => {
    const d = deps(); // a=jane@x.com (important), b=n@linkedin.com (unimportant)
    await d.sync.set(1, "100");
    const orig = d.gmail.getMeta.bind(d.gmail);
    d.gmail.getMeta = async (id: string) => {
      if (id === "a") { const e: any = new Error("Requested entity was not found."); e.code = 404; e.status = 404; throw e; }
      return (orig as any)(id);
    };
    const r = await runPoll(d);

    // The 404'd message is skipped (not surfaced, not counted, no throw); b still processes.
    expect(r.important).toEqual([]);
    expect(r.processed).toBe(1);          // only b was actually fetched; the phantom doesn't inflate the count
    expect(await d.seen.has(1, "a")).toBe(false); // nothing recorded for the gone message

    await r.commit();
    expect(await d.sync.get(1)).toBe("200"); // cursor advanced despite the dead message — no stall
  });

  it("skips a message the owner sent (SENT label) — never counted, ruled, or surfaced", async () => {
    // Self-addressed mail (mailing yourself, CC-ing yourself, or a reply in a
    // self-thread) is stored by Gmail as ONE message carrying both SENT and INBOX,
    // so it enters the "added to inbox" history exactly like real incoming mail.
    // It must be ignored: the poll reports incoming mail, not your own outgoing mail.
    const d = deps({
      gmail: fakeGmailClient({
        historyId: "200",
        addedSince: { "100": ["mine", "a"] },
        messages: {
          mine: { id:"mine", threadId:"t", snippet:"", labelIds:["SENT","INBOX"], payload:{ headers:[{name:"From",value:"me@x.com"},{name:"Subject",value:"my own reply"}] } },
          a: { id:"a", threadId:"t", snippet:"", payload:{ headers:[{name:"From",value:"jane@x.com"},{name:"Subject",value:"Lunch"}] } },
        },
      }),
    });
    await d.sync.set(1, "100");
    const r = await runPoll(d);
    expect(r.processed).toBe(1);                                  // self-sent skipped BEFORE counting; only jane counted
    expect(r.important.map((i: any) => i.messageId)).toEqual(["a"]); // jane surfaced, the self-sent message never is
    expect(r.unruled).toEqual([]);                               // not flagged as an un-ruled sender either
    expect(d.gmail.trashedIds!()).toEqual([]);                    // and never acted on
    expect(await d.seen.has(1, "mine")).toBe(false);              // just ignored — nothing recorded
  });

  it("skips messages already seen", async () => {
    const d = deps();
    await d.sync.set(1, "100");
    await d.seen.record(1, { messageId:"a", surfaced:true, verdict:"important", reason:"" });
    const r = await runPoll(d);
    expect(r.processed).toBe(1);                 // only b processed
    expect(r.important).toEqual([]);             // a was skipped, not re-surfaced
  });

  it("guarded senders: records action-log BEFORE trashing, defers seen so the report survives a failed send, surfaces the keeper", async () => {
    const d = guardedDeps();
    // capture call ordering to prove record-before-mutate (undo must always cover the trash)
    const order: string[] = [];
    const origRecord = d.actionLog.record.bind(d.actionLog);
    d.actionLog.record = async (...a: any[]) => { order.push("log"); return (origRecord as any)(...a); };
    const origTrash = d.gmail.trash.bind(d.gmail);
    d.gmail.trash = async (...a: any[]) => { order.push("trash"); return (origTrash as any)(...a); };

    await d.sync.set(1, "100");
    const r = await runPoll(d);

    // junk trashed, keeper untouched
    expect(d.gmail.trashedIds!()).toEqual(["gjunk"]);
    expect(r.guardedTrashed).toBe(1);
    expect(r.acted).toEqual([{ id: "gjunk", from: "promo@shop.com", subject: "50% off", action: "trashed" }]); // itemized (with id) for a replyable digest
    expect(order).toEqual(["log", "trash"]); // action-log recorded BEFORE the trash

    // undo covers exactly the trashed message
    expect(await d.actionLog.lastUndoable(1)).toMatchObject({ action: "trash", messageIds: ["gjunk"] });

    // Deferral: NOTHING is seen-recorded before commit — so if the brief send fails,
    // the retry re-processes the window and re-reports the trash (never silent).
    expect(await d.seen.has(1, "gjunk")).toBe(false);
    expect(await d.seen.has(1, "gkeep")).toBe(false);
    expect(r.important.map(i => i.messageId).sort()).toEqual(["gkeep", "jane"]);

    await r.commit();
    expect(await d.seen.has(1, "gjunk")).toBe(true);  // trashed msg recorded seen only after delivery
    expect(await d.seen.has(1, "gkeep")).toBe(true);
  });

  it("guarded archive: archives routine (logged before archive), keeps the important one in the inbox", async () => {
    const store = inMemoryStore();
    store.upsertRule({ matchValue: "list.com", scope: "domain", verdict: "unimportant", description: "list", action: "review_archive" });
    const d = {
      userId: 1, store,
      gmail: fakeGmailClient({
        historyId: "200",
        addedSince: { "100": ["routine", "urgent"] },
        messages: {
          routine: { id: "routine", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "news@list.com" }, { name: "Subject", value: "weekly" }, { name: "List-Unsubscribe", value: "<x>" }] } },
          urgent: { id: "urgent", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "news@list.com" }, { name: "Subject", value: "alert" }, { name: "List-Unsubscribe", value: "<x>" }] } },
        },
        bodies: { routine: "just news", urgent: "your account was locked, action required" },
      }),
      llm: {
        async classifyImportance() { return { important: false, suspicious: false, reason: "x" }; },
        async agentStep() { return { kind: "final", text: "" }; },
        async writeBrief() { return ""; },
        async reviewTrash(cands: any[]) { return cands.map(c => ({ id: c.id, keep: (c.bodyText ?? "").includes("locked"), reason: "r" })); },
      } as any,
      sync: fakeSyncRepo(), seen: fakeSeenRepo(), actionLog: fakeActionLogRepo(),
    };
    const order: string[] = [];
    const origRecord = d.actionLog.record.bind(d.actionLog);
    d.actionLog.record = async (...a: any[]) => { order.push("log"); return (origRecord as any)(...a); };
    const origArchive = d.gmail.archive.bind(d.gmail);
    d.gmail.archive = async (...a: any[]) => { order.push("archive"); return (origArchive as any)(...a); };

    await d.sync.set(1, "100");
    const r = await runPoll(d);

    expect(d.gmail.archivedIds!()).toEqual(["routine"]); // routine archived, not trashed
    expect(d.gmail.trashedIds!()).toEqual([]);
    expect(r.guardedArchived).toBe(1);
    expect(r.guardedTrashed).toBe(0);
    expect(order).toEqual(["log", "archive"]); // action-log recorded BEFORE the archive
    expect(await d.actionLog.lastUndoable(1)).toMatchObject({ action: "archive", messageIds: ["routine"] });
    expect(r.important.map(i => i.messageId)).toEqual(["urgent"]); // important kept in inbox + surfaced

    // deferral: acted id not seen until commit (report survives a failed send)
    expect(await d.seen.has(1, "routine")).toBe(false);
    await r.commit();
    expect(await d.seen.has(1, "routine")).toBe(true);
  });

  it("plain trash rule: trashes outright with no body-read (bypasses guardVet), logs before trashing, defers seen, doesn't surface", async () => {
    const d = plainTrashDeps("trash");
    const order: string[] = [];
    const origRecord = d.actionLog.record.bind(d.actionLog);
    d.actionLog.record = async (...a: any[]) => { order.push("log"); return (origRecord as any)(...a); };
    const origTrash = d.gmail.trash.bind(d.gmail);
    d.gmail.trash = async (...a: any[]) => { order.push("trash"); return (origTrash as any)(...a); };

    await d.sync.set(1, "100");
    const r = await runPoll(d);

    expect(d.gmail.trashedIds!()).toEqual(["p1"]);       // trashed despite an "important"-reading body → no body read
    expect(r.plainTrashed).toBe(1);
    expect(r.acted).toEqual([{ id: "p1", from: "promo@shop.com", subject: "sale", action: "trashed" }]);
    expect(r.guardedTrashed).toBe(0);                     // this was NOT the guarded path
    expect(order).toEqual(["log", "trash"]);             // undo recorded before the mutation
    expect(await d.actionLog.lastUndoable(1)).toMatchObject({ action: "trash", messageIds: ["p1"] });
    expect(r.important.map(i => i.messageId)).toEqual(["jane"]); // trashed sender not surfaced; jane still important

    expect(await d.seen.has(1, "p1")).toBe(false);        // deferred until commit (report survives a failed send)
    await r.commit();
    expect(await d.seen.has(1, "p1")).toBe(true);
  });

  it("plain archive rule: archives outright (logged before archive), never trashes", async () => {
    const d = plainTrashDeps("archive");
    await d.sync.set(1, "100");
    const r = await runPoll(d);

    expect(d.gmail.archivedIds!()).toEqual(["p1"]);
    expect(d.gmail.trashedIds!()).toEqual([]);
    expect(r.plainArchived).toBe(1);
    expect(r.plainTrashed).toBe(0);
    expect(await d.actionLog.lastUndoable(1)).toMatchObject({ action: "archive", messageIds: ["p1"] });
    expect(r.important.map(i => i.messageId)).toEqual(["jane"]);
  });

  it("guarded overflow beyond the cap is kept + surfaced, never trashed unread", async () => {
    const d = { ...guardedDeps(), guardedCap: 1 };
    await d.sync.set(1, "100");
    const r = await runPoll(d);

    // only the first guarded id is judged (and trashed); the second is overflow → kept, not trashed
    expect(d.gmail.trashedIds!()).toEqual(["gjunk"]);
    expect(r.guardedTrashed).toBe(1);
    expect(r.important.map(i => i.messageId).sort()).toEqual(["gkeep", "jane"]);
    expect(r.important.find(i => i.messageId === "gkeep")?.reason).toMatch(/overflow/i);
  });
});
