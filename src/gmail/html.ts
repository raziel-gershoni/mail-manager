// src/gmail/html.ts
import { parse } from "node-html-parser";

const HIDDEN_STYLE = /(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)/i;

export function htmlToText(html: string): string {
  if (!/[<>]/.test(html)) return html.replace(/\s+/g, " ").trim();
  const root = parse(html, { comment: false });
  for (const el of root.querySelectorAll("script,style")) el.remove();
  for (const el of root.querySelectorAll("[hidden]")) el.remove();
  for (const el of root.querySelectorAll("[style]")) {
    if (HIDDEN_STYLE.test(el.getAttribute("style") ?? "")) el.remove();
  }
  return root.text.replace(/\s+/g, " ").trim();
}
