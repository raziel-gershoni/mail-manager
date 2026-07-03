import { describe, it, expect } from "vitest";
import { activityFooter } from "../../src/telegram/bot.js";

describe("activityFooter", () => {
  it("maps tool names to verbs and collapses consecutive repeats", () => {
    expect(activityFooter("search_gmail,trash_messages")).toBe("\n\n_· searched · trashed_");
    expect(activityFooter("search_gmail,search_gmail,read_messages")).toBe("\n\n_· searched · read_");
  });
  it("is empty when no tools ran", () => {
    expect(activityFooter("none")).toBe("");
    expect(activityFooter("")).toBe("");
  });
  it("falls back to the raw name for an unknown tool", () => {
    expect(activityFooter("mystery_tool")).toBe("\n\n_· mystery_tool_");
  });
});
