// src/queue/failure.ts
// QStash calls our failureCallback once it has exhausted its retries. Its payload
// carries the ORIGINAL request base64-encoded in `sourceBody`, which is how we work
// out who was left waiting — nothing has to be stored up front.

export interface FailedTurn {
  chatId: number;    // where to apologise
  fromId?: number;   // who sent it, so we can answer in their language
  updateId?: number; // for correlating with worker logs
}

// Pure so the whole recovery path is testable without QStash. Returns null for
// anything it cannot confidently read: the caller stays silent rather than
// messaging a chat id it guessed at.
export function parseFailureBody(raw: unknown): FailedTurn | null {
  if (!raw || typeof raw !== "object") return null;
  const sourceBody = (raw as { sourceBody?: unknown }).sourceBody;
  if (typeof sourceBody !== "string" || !sourceBody) return null;
  let update: unknown;
  try {
    update = JSON.parse(Buffer.from(sourceBody, "base64").toString("utf8"));
  } catch {
    return null;
  }
  const msg = (update as { message?: { chat?: { id?: unknown }; from?: { id?: unknown } } })?.message;
  const chatId = msg?.chat?.id;
  if (typeof chatId !== "number") return null;
  const fromId = msg?.from?.id;
  const updateId = (update as { update_id?: unknown }).update_id;
  return {
    chatId,
    fromId: typeof fromId === "number" ? fromId : undefined,
    updateId: typeof updateId === "number" ? updateId : undefined,
  };
}
