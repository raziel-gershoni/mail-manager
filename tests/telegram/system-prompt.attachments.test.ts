// tests/telegram/system-prompt.attachments.test.ts
// The prompt's "explain this ACCURATELY" account of how mail is handled must stay true
// now that attachments are seen, read on request, and read for the digest.
import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT } from "../../src/telegram/bot.js";

describe("SYSTEM_PROMPT and attachment names in triage", () => {
  it("says the importance check sees attachment names/types — and still no body", () => {
    expect(SYSTEM_PROMPT).toMatch(/SUBJECT, a short SNIPPET and the names\/types of any attachments only — no body at that point/);
    expect(SYSTEM_PROMPT).toMatch(/categorize it from subject\+snippet\+attachment names/);
  });
});
