// src/util/log.ts
// Structured JSON log lines (captured by Vercel's log viewer; greppable by `event`).
export function log(event: string, fields: Record<string, unknown> = {}): void {
  try { console.log(JSON.stringify({ event, ...fields })); }
  catch { console.log(event); }
}
