import { describe, it, expect } from "vitest";
import { languageDirective } from "../../src/telegram/bot.js";

describe("languageDirective", () => {
  it("names the language and forces it regardless of the email's language", () => {
    expect(languageDirective("he")).toMatch(/Hebrew/);
    expect(languageDirective("en")).toMatch(/English/);
    expect(languageDirective("he")).toMatch(/even if/i);
    // the anti-injection reminder rides along
    expect(languageDirective("he")).toMatch(/untrusted/i);
  });
});
