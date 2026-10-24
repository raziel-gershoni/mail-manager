// tests/telegram/client.test.ts
// A long brief goes out as several messages back to back, right after any streaming
// edits, so Telegram may answer one with 429 "retry after N". Every bot the app sends
// through waits as told and retries (bounded), instead of failing the whole message.
import { describe, it, expect } from "vitest";
import { telegramBot, TELEGRAM_MAX_RETRIES } from "../../src/telegram/client.js";

type Reply = { ok: boolean; result?: unknown; error_code?: number; description?: string; parameters?: { retry_after?: number } };
function fakeFetch(replies: Array<Reply | Error>) {
  let calls = 0;
  const fn = (async () => {
    const r = replies[Math.min(calls++, replies.length - 1)]!;
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls: () => calls };
}
const sent = { ok: true, result: { message_id: 5, date: 0, chat: { id: 1, type: "private" }, text: "hi" } };
const tooMany: Reply = { ok: false, error_code: 429, description: "Too Many Requests: retry after 0", parameters: { retry_after: 0 } };

describe("telegramBot", () => {
  it("waits out a 429 and retries the same request", async () => {
    const f = fakeFetch([tooMany, sent]);
    const bot = telegramBot("123:abc", { fetch: f.fn });
    const m = await bot.api.sendMessage(1, "hi");
    expect(m.message_id).toBe(5);
    expect(f.calls()).toBe(2);
  });

  it("gives up after a bounded number of retries", async () => {
    const f = fakeFetch([tooMany]);
    const bot = telegramBot("123:abc", { fetch: f.fn });
    await expect(bot.api.sendMessage(1, "hi")).rejects.toThrow(/429|Too Many Requests/);
    expect(f.calls()).toBe(TELEGRAM_MAX_RETRIES + 1);
  });

  it("does not wait when Telegram asks for longer than a run can afford", async () => {
    const f = fakeFetch([{ ...tooMany, parameters: { retry_after: 600 } }, sent]);
    const bot = telegramBot("123:abc", { fetch: f.fn });
    await expect(bot.api.sendMessage(1, "hi")).rejects.toThrow(/429|Too Many Requests/);
    expect(f.calls()).toBe(1);
  });

  it("fails a network error straight away instead of retrying it forever", async () => {
    const f = fakeFetch([new Error("ECONNRESET")]);
    const bot = telegramBot("123:abc", { fetch: f.fn });
    await expect(bot.api.sendMessage(1, "hi")).rejects.toThrow();
    expect(f.calls()).toBe(1);
  });
});
