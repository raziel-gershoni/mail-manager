import { describe, it, expect } from "vitest";
import { archiveMessagesTool, trashMessagesTool } from "../../src/cleanup/tools.js";
import { fakeActionLogRepo, fakeProposalRepo } from "../../src/cleanup/proposals.js";
import { fakeGmailClient } from "../../src/gmail/client.js";

function ctxWith(gmail: any, actionLog: any) {
  return { userId: 1, gmail, memory: null, proposals: fakeProposalRepo(), actionLog, llm: {} } as any;
}
const gmailOpts = { historyId: "1", addedSince: {}, messages: {} };

describe("direct action tools", () => {
  it("trash_messages trashes named ids (no vet) and logs a trash action", async () => {
    const gmail = fakeGmailClient(gmailOpts); const log = fakeActionLogRepo();
    const res = await trashMessagesTool().run({ ids: ["m1", "m2"], reason: "junk" }, ctxWith(gmail, log)) as any;
    expect(res.ok).toBe(true); expect(res.trashed).toBe(2);
    expect(gmail.trashedIds!().sort()).toEqual(["m1", "m2"]);
    expect((await log.lastUndoable(1))!.action).toBe("trash");
  });
  it("archive_messages archives named ids and logs an archive action", async () => {
    const gmail = fakeGmailClient(gmailOpts); const log = fakeActionLogRepo();
    const res = await archiveMessagesTool().run({ ids: ["m3"], reason: "read it" }, ctxWith(gmail, log)) as any;
    expect(res.ok).toBe(true); expect(res.archived).toBe(1);
    expect(gmail.archivedIds!()).toEqual(["m3"]);
    expect((await log.lastUndoable(1))!.action).toBe("archive");
  });
  it("empty ids is a no-op error", async () => {
    const gmail = fakeGmailClient(gmailOpts);
    const res = await trashMessagesTool().run({ ids: [] }, ctxWith(gmail, fakeActionLogRepo())) as any;
    expect(res.ok).toBe(false);
  });
});
