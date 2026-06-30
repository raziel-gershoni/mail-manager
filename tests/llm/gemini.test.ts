import { describe, it, expect } from "vitest";
import { parseClassifyJson } from "../../src/llm/gemini.js";

describe("parseClassifyJson", () => {
  it("normalizes a well-formed response", () => {
    const r = parseClassifyJson('{"important":true,"suspicious":false,"reason":"from a person"}');
    expect(r).toEqual({ important:true, suspicious:false, reason:"from a person" });
  });
  it("recall-bias: defaults to important when the model omits the field", () => {
    const r = parseClassifyJson('{"reason":"unclear"}');
    expect(r.important).toBe(true);
    expect(r.suspicious).toBe(true);
  });
  it("throws on non-JSON so the caller can fall back to important", () => {
    expect(() => parseClassifyJson("not json")).toThrow();
  });
});
