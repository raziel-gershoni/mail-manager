// tests/agent/tools.search-attachments.test.ts
// search_gmail must not spread Gmail's attachment ids into its result. Real ids are long
// opaque tokens, and a sliced newsletter keeps 10-30 images, so a 25-row search could pass
// the 40k tool-result cap in src/llm/gemini.ts, which then cuts the JSON mid-row.
import { describe, it, expect } from "vitest";
import { readOnlyTools, dispatchTool } from "../../src/agent/tools.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import type { GmailPart } from "../../src/gmail/parts.js";
import type { GmailRawMessage } from "../../src/gmail/headers.js";
import { slicedNewsletter } from "../fixtures/mime.js";

const ROWS = 25;   // search's default page size
const SLICES = 20; // kept images per newsletter
const TOOL_RESULT_CAP = 40_000;

// The shape of a real Gmail attachmentId: a ~400-char base64url token, unique per part.
const realId = (messageId: string, partId: string): string =>
  `ANGjdJ_${Buffer.from(`${messageId}/${partId}`).toString("base64url")}`.padEnd(400, "8k2Qx_Lr-Vb7");

function withRealIds(raw: GmailRawMessage): GmailRawMessage {
  const visit = (p: GmailPart): GmailPart => ({
    ...p,
    ...(p.body?.attachmentId ? { body: { ...p.body, attachmentId: realId(raw.id, p.partId ?? "") } } : {}),
    ...(p.parts ? { parts: p.parts.map(visit) } : {}),
  });
  return { ...raw, payload: raw.payload && visit(raw.payload) };
}

function setup() {
  const ids = Array.from({ length: ROWS }, (_, i) => `m${i}`);
  const messages = Object.fromEntries(ids.map((id, i) => [id, withRealIds(slicedNewsletter(id, SLICES, { from: `Shop ${i} <news@shop${i}.com>`, subject: `Sale ${i}` }))]));
  const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages, searchResults: { "in:inbox from:shop": ids } });
  return { gmail, ctx: { userId: 1, memory: inMemoryStore(), gmail } };
}

describe("search_gmail attachments", () => {
  it("gives each row a one-line attachment summary and never Gmail's long attachment ids, staying under the tool cap", async () => {
    const { gmail, ctx } = setup();
    // The raw metas DO carry the ids: spreading them would blow the cap.
    expect(JSON.stringify(await gmail.search("in:inbox from:shop")).length).toBeGreaterThan(TOOL_RESULT_CAP);

    const rows = await dispatchTool("search_gmail", { query: "from:shop" }, ctx, readOnlyTools()) as any[];
    expect(rows).toHaveLength(ROWS);
    expect(rows.map(r => r.subject)).toEqual(Array.from({ length: ROWS }, (_, i) => `Sale ${i}`));
    for (const r of rows) expect(r.attachments).toBe(`image-${SLICES}.png (PNG image, ${29 + SLICES} KB) + ${SLICES - 1} more images`);
    const json = JSON.stringify(rows);
    expect(json).not.toContain("ANGjdJ_");
    expect(json).not.toContain("attachmentId");
    expect(json.length).toBeLessThan(TOOL_RESULT_CAP);
  });
});
