// src/weekly/text.ts
// How the weekly reports show their UNTRUSTED fields (sender, subject, the model's reason,
// top senders): defanged, so nothing in them can be tapped, and then clipped to one line.

// One shared line-clipper. Every whitespace run, newlines included, becomes one space, so a
// field stays on its own line and can't render as an extra, fake "2." item — the numbered
// lines always match the report's refs. Then it's bounded to `max` characters, counted
// and cut by CODE POINT: cutting by UTF-16 unit could split an emoji and leave a lone
// surrogate, which Telegram rejects — the send would fail and the week's key never be set.
export function clipLine(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  const cps = Array.from(one);
  return cps.length > max ? `${cps.slice(0, max - 1).join("")}…` : one;
}

// Characters that are invisible or reorder text, which an email can use to disguise a
// token or forge how a line reads: C0 and C1 controls (whitespace aside — clipLine
// collapses it), the soft hyphen, bidi marks, embeddings, overrides and isolates,
// zero-width characters, the word-joiner family, the BOM and Unicode tag characters.
const INVISIBLE = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁯﻿\u{E0000}-\u{E007F}]/gu;

// Telegram auto-links some text even in a plain message (no parse_mode): bare URLs and
// domains, email addresses, @mentions and /commands — and a /command tapped in the bot's
// chat is SENT to the bot. defang rewrites each shape into a readable form that doesn't link:
//   https://x → hxxps://x   tg://x → tg[:]//x   paypa1-secure.com → paypa1-secure[.]com
//   a@b.com → a[at]b[.]com   @name → ＠name   /cmd → ∕cmd (U+2215 at the start of a token)
// A dot is defanged where it sits between a letter or digit and two letters (where every
// domain's last dot sits), so "$12.50", "v1.2" and "e.g." read as before. Invisible
// characters go first, so they can't hide a token from the rest. Idempotent.
export function defang(s: string): string {
  return s
    .replace(INVISIBLE, "")
    .replace(/\bhttp(s?):\/\//gi, (_m, sec: string) => `hxxp${sec}://`)
    .replace(/\b([a-z][a-z0-9+.-]*):\/\//gi, (m, scheme: string) => /^hxxps?$/i.test(scheme) ? m : `${scheme}[:]//`)
    .replace(/(?<=[\p{L}\p{M}\p{N}._%+-])@(?=[\p{L}\p{N}])/gu, "[at]")
    .replace(/@/g, "＠")
    .replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, "$1[.]$2[.]$3[.]$4")
    .replace(/(?<=[\p{L}\p{M}\p{N}_-])[.。．｡](?=[\p{L}\p{M}]{2})/gu, "[.]")
    .replace(/(?<![\p{L}\p{M}\p{N}_/])\/(?=[A-Za-z0-9_])/gu, "∕");
}

// An untrusted field as a report shows it: defanged, then on one bounded line.
export function untrustedLine(s: string, max: number): string {
  return clipLine(defang(s), max);
}
