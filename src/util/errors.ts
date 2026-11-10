// The one place server code turns a caught error into text for logs, ops events and the
// agent's tool results. Server code only: it imports drizzle-orm, so app/miniapp must not use it.
import { DrizzleQueryError } from "drizzle-orm";

// drizzle-orm wraps every driver error in a DrizzleQueryError whose message embeds the full
// SQL and its bound parameters: mail text, rule text, the encrypted refresh token. Report
// the driver's own error instead, as before drizzle 0.44.
export function withoutQuery(err: unknown): unknown {
  if (err instanceof DrizzleQueryError) return err.cause ?? new Error("database query failed");
  return err;
}

export function errorText(err: unknown): string {
  const e = withoutQuery(err);
  return e instanceof Error ? e.message : String(e);
}
