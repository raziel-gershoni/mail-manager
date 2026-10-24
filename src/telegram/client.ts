// src/telegram/client.ts
// The one way the app builds a Telegram bot client.
//
// A long brief goes out as several messages back to back, often right after a stream of
// edits, so Telegram can answer with 429 "retry after N". The official auto-retry plugin
// waits exactly as long as Telegram asks and sends the same request again; it also backs
// off and retries a 5xx. Both are bounded, so a run never waits out its own time limit:
// - at most 2 retries per request;
// - a wait longer than 10s isn't waited for (the call throws, and the caller's own retry
//   path takes over: the next hourly poll, or the QStash retry of a chat turn).
// The plugin also pauses after its last failed attempt, so one request costs at most
// (2 + 1) x 10s = 30s before it gives up.
// A network error is NOT retried here: the plugin would retry it without any bound.
import { Bot, type ApiClientOptions } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";

export const TELEGRAM_MAX_RETRIES = 2;
export const TELEGRAM_MAX_RETRY_WAIT_S = 10;

export function telegramBot(token: string, client?: ApiClientOptions): Bot {
  const bot = new Bot(token, client ? { client } : undefined);
  bot.api.config.use(autoRetry({
    maxRetryAttempts: TELEGRAM_MAX_RETRIES,
    maxDelaySeconds: TELEGRAM_MAX_RETRY_WAIT_S,
    rethrowHttpErrors: true,
  }));
  return bot;
}
