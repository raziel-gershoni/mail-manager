import { describe, it, expect } from "vitest";
import { activityFooter } from "../../src/telegram/bot.js";
import { readOnlyTools } from "../../src/agent/tools.js";
import { trashTools } from "../../src/cleanup/tools.js";

describe("activityFooter", () => {
  it("maps tool names to verbs and collapses consecutive repeats (en)", () => {
    expect(activityFooter("search_gmail,trash_messages", "en")).toBe("\n\n_· searched · trashed_");
    expect(activityFooter("search_gmail,search_gmail,read_messages", "en")).toBe("\n\n_· searched · read_");
  });
  it("renders verbs in Hebrew", () => {
    expect(activityFooter("search_gmail,read_messages", "he")).toBe("\n\n_· חיפשתי · קראתי_");
  });
  it("is empty when no tools ran", () => {
    expect(activityFooter("none", "en")).toBe("");
    expect(activityFooter("", "he")).toBe("");
  });
  it("falls back to the raw name for an unknown tool", () => {
    expect(activityFooter("mystery_tool", "en")).toBe("\n\n_· mystery_tool_");
  });

  // Every tool the agent can call needs a verb, or a Hebrew conversation ends with a
  // raw English tool name in its footer (this app has a Hebrew user).
  it("localizes the preference and restore verbs instead of leaking the raw tool name", () => {
    expect(activityFooter("propose_preference,confirm_preference", "en")).toBe("\n\n_· drafted a preference · saved a preference_");
    expect(activityFooter("propose_preference,confirm_preference", "he")).toBe("\n\n_· ניסחתי העדפה · שמרתי העדפה_");
    expect(activityFooter("restore_messages", "he")).toBe("\n\n_· שחזרתי_");
    expect(activityFooter("recent_activity", "he")).toBe("\n\n_· בדקתי פעילות אחרונה_");
  });

  it("has a verb for EVERY callable tool — no raw English name can reach a Hebrew footer", () => {
    const names = [...readOnlyTools(), ...trashTools()].map(t => t.schema.name);
    for (const name of names) {
      expect(activityFooter(name, "he"), `${name} has no TOOL_VERB_KEYS entry`).not.toContain(name);
    }
  });
});
