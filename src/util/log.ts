// src/util/log.ts
// Structured JSON log lines (captured by Vercel's log viewer; greppable by `event`).
export function log(event: string, fields: Record<string, unknown> = {}): void {
  try { console.log(JSON.stringify({ event, ...fields })); }
  catch { console.log(event); }
}

const SNIPPET_MAX = 200;
// Log-safe projection of a message: who / what / a short preview. Includes sender,
// subject and a truncated snippet — but NEVER full bodies, tokens, or secrets.
// Use this everywhere email metadata is logged so the shape stays consistent.
export function logMeta(m: { id?: string; from?: string; subject?: string; snippet?: string }): Record<string, unknown> {
  const out: Record<string, unknown> = { id: m.id, from: m.from, subject: m.subject };
  if (m.snippet) out.snippet = m.snippet.slice(0, SNIPPET_MAX);
  return out;
}

// Truncate free text (e.g. a message body preview) for logging — bounded so logs
// stay small; the caller decides whether the text is safe to log at all.
export function logPreview(text: string, max = 300): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}
