import { describe, it, expect } from "vitest";
import { activityFooter } from "../../src/telegram/bot.js";

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
});
