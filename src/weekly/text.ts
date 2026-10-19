// src/weekly/text.ts
// One shared line-clipper for the weekly reports' UNTRUSTED fields (sender, subject, the
// model's reason). Every whitespace run, newlines included, becomes one space, so a field
// stays on its own line and can't render as an extra, fake "2." item — the numbered
// lines always match the report's refs. Then it's bounded to `max` characters, counted
// and cut by CODE POINT: cutting by UTF-16 unit could split an emoji and leave a lone
// surrogate, which Telegram rejects — the send would fail and the week's key never be set.
export function clipLine(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  const cps = Array.from(one);
  return cps.length > max ? `${cps.slice(0, max - 1).join("")}…` : one;
}
