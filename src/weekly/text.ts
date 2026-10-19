// src/weekly/text.ts
// One shared line-clipper for the weekly reports' UNTRUSTED fields (sender, subject, the
// model's reason). Every whitespace run, newlines included, becomes one space, so a field
// stays on its own line and can't render as an extra, fake "2." item — the numbered
// lines always match the report's refs. Then it's bounded to `max` characters.
export function clipLine(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}
