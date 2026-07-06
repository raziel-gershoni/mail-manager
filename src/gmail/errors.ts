// Classifiers for Gmail API errors. Mirrors src/oauth/reconnect.ts:isInvalidGrant.

// True for a Gmail "Requested entity was not found." (HTTP 404). history.list can
// reference a message that was deleted/removed before messages.get runs; that get
// 404s. Callers use this to skip the dead message instead of aborting the whole
// operation (which, in the poll, would stall the cursor and re-404 every cycle).
export function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  return e.code === 404 || e.code === "404" || e.status === 404 || e.response?.status === 404;
}
