import { describe, it, expect } from "vitest";
import { escapeHtml } from "../../src/http/html.js";

describe("escapeHtml", () => {
  it("escapes the HTML-significant characters", () => {
    expect(escapeHtml(`<script>alert("x")&'`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;");
  });
  it("leaves a normal email untouched", () => {
    expect(escapeHtml("dana@x.com")).toBe("dana@x.com");
  });
});
