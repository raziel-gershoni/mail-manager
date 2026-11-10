// src/gmail/html.ts
import { parse, HTMLElement, TextNode, type Node } from "node-html-parser";

const HIDDEN_STYLE = /(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)/i;

export function htmlToText(html: string): string {
  if (!/[<>]/.test(html)) return html.replace(/\s+/g, " ").trim();
  const root = parse(html, { comment: false });
  for (const el of root.querySelectorAll("script,style")) el.remove();
  for (const el of root.querySelectorAll("[hidden]")) el.remove();
  for (const el of root.querySelectorAll("[style]")) {
    if (HIDDEN_STYLE.test(el.getAttribute("style") ?? "")) el.remove();
  }
  return textOf(root).replace(/\s+/g, " ").trim();
}

// The parser's own .text recurses once per nesting level, so a mail nested a few thousand
// elements deep overflowed the stack. This walks the same tree in the same order with an
// explicit stack: decoded text nodes, and "\n" for <br>, as .text gives.
function textOf(root: HTMLElement): string {
  let out = "";
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node instanceof TextNode) out += node.text;
    else if (node instanceof HTMLElement) {
      if (/^br$/i.test(node.rawTagName ?? "")) { out += "\n"; continue; }
      for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]!);
    }
  }
  return out;
}
