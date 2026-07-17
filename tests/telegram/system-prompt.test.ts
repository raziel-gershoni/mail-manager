// tests/telegram/system-prompt.test.ts
// The classification guidance is prefixed "explain this ACCURATELY ... never invent",
// so the model will state it confidently when the owner asks "did you read that?" or
// "why did you trash that?". These pin the facts it asserts to what the code does —
// the standing-preference path DOES read un-ruled bodies and DOES auto-act on them.
import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT } from "../../src/telegram/bot.js";

describe("SYSTEM_PROMPT classification guidance", () => {
  it("keeps the accuracy framing that makes the owner trust its answer", () => {
    expect(SYSTEM_PROMPT).toMatch(/explain this ACCURATELY if the owner asks — never invent/);
  });

  it("no longer makes the claims the preference path falsified", () => {
    // Each of these was true before standing preferences shipped and is now false for
    // preference-matched mail. They must not survive anywhere in the prompt.
    expect(SYSTEM_PROMPT).not.toMatch(/un-ruled mail is NEVER auto-trashed or archived/i);
    expect(SYSTEM_PROMPT).not.toMatch(/Full bodies are read only for guarded/i);
    expect(SYSTEM_PROMPT).not.toMatch(/Never claim the poll read an un-ruled email's body/i);
  });

  it("states the preference path truthfully: body IS read, and matching mail IS auto-acted", () => {
    expect(SYSTEM_PROMPT).toMatch(/reads that message's FULL BODY/i);
    expect(SYSTEM_PROMPT).toMatch(/preference that HAS an action IS acted on autonomously/i);
    // ...and that acting still requires the body-read judge to confirm (never subject-only).
    expect(SYSTEM_PROMPT).toMatch(/only if it confirms is the message trashed\/archived/i);
    // The remaining "never auto-acted" claim must stay scoped to mail matching no
    // actionable preference — not asserted of un-ruled mail in general.
    expect(SYSTEM_PROMPT).toMatch(/matching no preference-with-an-action is NEVER auto-trashed or archived/i);
  });

  it("tells the model to look up what actually happened rather than guess", () => {
    expect(SYSTEM_PROMPT).toMatch(/why did you trash that\?/i);
    expect(SYSTEM_PROMPT).toMatch(/do NOT guess: call recent_activity/i);
  });
});
