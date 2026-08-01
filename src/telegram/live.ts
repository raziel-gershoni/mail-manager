// src/telegram/live.ts
// Feedback while a turn is running: the native "typing…" status, and a live reply
// that streams the answer into the chat.
//
// EVERY function here is best-effort. A failure to show progress must never fail
// the turn — the owner would rather get an unformatted answer than no answer, so
// every Telegram error is swallowed and logged.
import type { Bot } from "grammy";
import telegramifyMarkdown from "telegramify-markdown";
import { sendFormatted } from "./send.js";
import { log } from "../util/log.js";

// Telegram clears the "typing…" status after about 5s, so refresh just inside that.
export const TYPING_REFRESH_MS = 4_000;
// One edit per 1.5s stays comfortably under Telegram's per-chat rate limit while
// still reading as live.
export const STREAM_EDIT_MS = 1_500;
// Don't post a three-character first chunk: that chunk IS the phone notification
// preview, and "Two" tells the owner nothing.
export const STREAM_MIN_CHARS = 24;

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// grammy surfaces Telegram's error_code on GrammyError; 429 is "slow down".
function isRateLimited(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { error_code?: number }).error_code === 429;
}

// Keep the "typing…" status alive for the whole turn. Returns stop() — call it
// from a `finally` so a thrown turn can't leave the interval running.
export function startTyping(bot: Bot, chatId: number): () => void {
  const tick = () => {
    void bot.api.sendChatAction(chatId, "typing").catch(err => log("live.typing_error", { error: errText(err) }));
  };
  tick(); // immediately, so the status appears before the first model call
  const timer = setInterval(tick, TYPING_REFRESH_MS);
  return () => clearInterval(timer);
}

export interface LiveReply {
  push(delta: string): void;
  // Throw away whatever has been streamed so far, removing it from the chat if it
  // already landed. Two callers: a step that turns out to be a tool call (its prose
  // was not the answer), and a turn that dies mid-stream (leaving the fragment would
  // stack a second partial under it when QStash retries). Returns the settled queue
  // so the dying-turn caller can await the delete before the function exits; the
  // tool-call caller ignores it.
  discard(): Promise<void>;
  commit(finalText: string): Promise<number | undefined>;
  posted(): boolean;
}

// A reply that fills in as the model writes it.
//
// The FIRST flush is a sendMessage, not an edit: that is what makes the phone
// notification carry real answer text instead of a placeholder. Streaming flushes
// are plain text, because a half-written "**bold" is not valid MarkdownV2 and
// rendering partial input produces garbage; commit() does one final edit with the
// proper MarkdownV2 render, so the finished message looks exactly like every other
// reply the bot sends.
export function liveReply(bot: Bot, chatId: number, opts: { now?: () => number } = {}): LiveReply {
  const now = opts.now ?? (() => Date.now());
  let buffer = "";               // everything the model has written this step
  let shownText = "";            // what Telegram is currently displaying
  let messageId: number | undefined;
  let started = false;           // set synchronously, so two fast pushes can't both send
  let lastFlush = 0;
  let interval = STREAM_EDIT_MS; // doubles on 429
  // Serialize every Telegram call. Without this a slow sendMessage and a fast edit
  // could race and the edit would target an id that doesn't exist yet.
  let chain: Promise<void> = Promise.resolve();

  // The scheduled task reads `buffer` and `messageId` at EXECUTION time, not at
  // schedule time, so it always sends the freshest text and always knows whether
  // a message exists yet.
  const schedule = (): void => {
    chain = chain.then(async () => {
      const text = buffer;
      if (!text || text === shownText) return;
      try {
        if (messageId === undefined) {
          const m = await bot.api.sendMessage(chatId, text);
          messageId = m.message_id;
        } else {
          await bot.api.editMessageText(chatId, messageId, text);
        }
        shownText = text;
      } catch (err) {
        if (isRateLimited(err)) interval *= 2; // back off rather than hammer the chat
        log("live.flush_error", { error: errText(err) });
      }
    });
  };

  return {
    push(delta) {
      buffer += delta;
      if (!buffer || buffer === shownText) return;
      if (!started) {
        // The first message is gated on length, NOT on the throttle — the owner
        // should see the answer begin the moment there's something worth reading.
        if (buffer.length < STREAM_MIN_CHARS) return;
        started = true;
        lastFlush = now();
        schedule();
        return;
      }
      if (now() - lastFlush < interval) return;
      lastFlush = now();
      schedule();
    },

    discard() {
      // Reset synchronously so any already-queued flush finds an empty buffer and
      // no-ops, and so a later step starts clean — its answer then arrives as a
      // fresh, notifying message rather than being appended to abandoned prose.
      const stray = messageId;
      buffer = ""; shownText = ""; started = false; messageId = undefined;
      if (stray === undefined) return chain;
      chain = chain.then(async () => {
        try { await bot.api.deleteMessage(chatId, stray); }
        catch (err) { log("live.delete_error", { error: errText(err) }); }
      });
      return chain;
    },

    // The one method here that is NOT best-effort. Streaming is a nicety, but the
    // final text is the turn's actual output: if nothing reached the chat, commit
    // propagates so the worker fails, QStash retries, and — if it never lands —
    // the failure callback apologises. Swallowing it would silently lose the reply,
    // which is the very failure this module exists to prevent. Once text IS on
    // screen the asymmetry flips: a failed re-render costs only formatting, so it
    // is swallowed.
    async commit(finalText) {
      buffer = finalText;
      await chain; // let any in-flight send/edit settle so messageId is settled too
      if (messageId === undefined) return sendFormatted(bot, chatId, finalText);
      const id = messageId;
      try {
        await bot.api.editMessageText(chatId, id, telegramifyMarkdown(finalText, "escape"), { parse_mode: "MarkdownV2" });
      } catch (err) {
        // Formatting failed (bad entities, or the text is already identical).
        // The streamed plain text is still correct — try once more without markup,
        // and if even that fails, leave what's on screen rather than lose the answer.
        log("live.commit_format_error", { error: errText(err) });
        try { await bot.api.editMessageText(chatId, id, finalText); }
        catch (err2) { log("live.commit_error", { error: errText(err2) }); }
      }
      return id;
    },

    posted() { return messageId !== undefined; },
  };
}
