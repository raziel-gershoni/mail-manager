// tests/cleanup/attachment-line.test.ts
import { describe, it, expect } from "vitest";
import { readCandidates } from "../../src/cleanup/read-candidates.js";
import { proposeTrashTool } from "../../src/cleanup/tools.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeReviewLLM, type TrashCandidate } from "../../src/llm/provider.js";
import { fakeProposalRepo, fakeActionLogRepo } from "../../src/cleanup/proposals.js";
import { KB, MB, filePart, inlineImage, withAttachments } from "../fixtures/mime.js";

const BULK = [{ name: "List-Unsubscribe", value: "<mailto:u@shop.com>" }];
function gmail() {
  return fakeGmailClient({ historyId: "1", addedSince: {}, messages: {
    deal: withAttachments("deal", "This week's deals inside.", [filePart("1", "catalog.pdf", "application/pdf", 2 * MB), inlineImage("2", "image/jpeg", 90 * KB)], { from: "promo@shop.com", subject: "Weekly deals", headers: BULK }),
    plain: { id: "plain", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "promo@shop.com" }, { name: "Subject", value: "More deals" }, ...BULK] } },
  } });
}

describe("attachment line on trash candidates", () => {
  it("readCandidates (guarded and preference vets) sets it from the message, and omits it when there are no files", async () => {
    const { candidates } = await readCandidates(["deal", "plain"], { gmail: gmail(), cap: 10 });
    expect(candidates[0]!.attachmentLine).toBe("catalog.pdf (PDF, 2.0 MB) + 1 image");
    expect(candidates[0]!.bodyText).toBe("This week's deals inside.");
    expect("attachmentLine" in candidates[1]!).toBe(false);
  });
  it("propose_trash hands the reviewer the line too", async () => {
    const seen: TrashCandidate[] = [];
    const ctx = { userId: 1, memory: inMemoryStore(), proposals: fakeProposalRepo(), actionLog: fakeActionLogRepo(), gmail: gmail(),
      llm: fakeReviewLLM(c => { seen.push(...c); return []; }) };
    await proposeTrashTool().run({ ids: ["deal", "plain"], reason: "deals" }, ctx);
    expect(seen.map(c => [c.id, c.attachmentLine])).toEqual([["deal", "catalog.pdf (PDF, 2.0 MB) + 1 image"], ["plain", undefined]]);
  });
});
