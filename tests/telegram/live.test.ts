// tests/telegram/live.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Bot } from "grammy";
import { liveReply, startTyping, STREAM_EDIT_MS, STREAM_MIN_CHARS, TYPING_REFRESH_MS } from "../../src/telegram/live.js";
import { TELEGRAM_PART_CHARS } from "../../src/telegram/send.js";

// The live sink serializes every Telegram call on an internal promise chain, so a
// test that only pushes has to let the microtask queue drain before asserting.
const settle = () => new Promise(r => setTimeout(r, 0));

function fakeBot(overrides: Partial<Record<"sendMessage" | "editMessageText" | "deleteMessage", () => Promise<never>>> = {}) {
  const calls: { kind: string; text?: string; id?: number; mode?: string }[] = [];
  const api = {
    sendMessage: overrides.sendMessage ?? (async (_c: number, text: string, other?: any) => {
      calls.push({ kind: "send", text, mode: other?.parse_mode }); return { message_id: 42 };
    }),
    editMessageText: overrides.editMessageText ?? (async (_c: number, id: number, text: string, other?: any) => {
      calls.push({ kind: "edit", id, text, mode: other?.parse_mode }); return true;
    }),
    deleteMessage: overrides.deleteMessage ?? (async (_c: number, id: number) => {
      calls.push({ kind: "delete", id }); return true;
    }),
    sendChatAction: async () => { calls.push({ kind: "action" }); return true; },
  };
  return { bot: { api } as unknown as Bot, calls };
}

const long = "x".repeat(STREAM_MIN_CHARS);

describe("liveReply streaming", () => {
  it("stays quiet until the first chunk is worth a notification", async () => {
    const { bot, calls } = fakeBot();
    const live = liveReply(bot, 1);
    live.push("hi");
    await settle();
    expect(calls).toEqual([]);
    expect(live.posted()).toBe(false);
  });

  it("SENDS the first chunk (so the notification carries real text), then EDITS", async () => {
    let t = 0;
    const { bot, calls } = fakeBot();
    const live = liveReply(bot, 1, { now: () => t });
    live.push(long);
    await settle();
    t += STREAM_EDIT_MS + 1;
    live.push(" more");
    await settle();
    expect(calls.map(c => c.kind)).toEqual(["send", "edit"]);
    expect(calls[0]!.text).toBe(long);
    expect(calls[1]!.text).toBe(long + " more");
    expect(live.posted()).toBe(true);
  });

  it("throttles edits: rapid deltas inside the window cost one call, carrying the latest text", async () => {
    let t = 0;
    const { bot, calls } = fakeBot();
    const live = liveReply(bot, 1, { now: () => t });
    live.push(long);
    await settle();
    live.push("a"); live.push("b"); live.push("c"); // all inside STREAM_EDIT_MS
    await settle();
    expect(calls.map(c => c.kind)).toEqual(["send"]);
    t += STREAM_EDIT_MS + 1;
    live.push("d");
    await settle();
    expect(calls.map(c => c.kind)).toEqual(["send", "edit"]);
    expect(calls[1]!.text).toBe(long + "abcd"); // the skipped deltas are not lost
  });

  it("skips an edit when the text has not changed", async () => {
    let t = 0;
    const { bot, calls } = fakeBot();
    const live = liveReply(bot, 1, { now: () => t });
    live.push(long);
    await settle();
    t += STREAM_EDIT_MS + 1;
    live.push(""); // no new text
    await settle();
    expect(calls.map(c => c.kind)).toEqual(["send"]);
  });

  it("commit re-renders the finished message as MarkdownV2", async () => {
    const { bot, calls } = fakeBot();
    const live = liveReply(bot, 1);
    live.push(long);
    await settle();
    await live.commit("**done**");
    const last = calls.at(-1)!;
    expect(last.kind).toBe("edit");
    expect(last.mode).toBe("MarkdownV2");
  });

  it("commit sends a normal message when nothing ever streamed", async () => {
    const { bot, calls } = fakeBot();
    const live = liveReply(bot, 1);
    const id = await live.commit("no streaming happened");
    expect(calls.map(c => c.kind)).toEqual(["send"]);
    expect(calls[0]!.mode).toBe("MarkdownV2");
    expect(id).toBe(42);
  });

  it("commit falls back to a plain edit when the MarkdownV2 edit is rejected", async () => {
    const calls: string[] = [];
    let first = true;
    const bot = { api: {
      sendMessage: async () => ({ message_id: 7 }),
      editMessageText: async (_c: number, _id: number, _text: string, other?: any) => {
        calls.push(other?.parse_mode ?? "plain");
        if (first) { first = false; throw new Error("can't parse entities"); }
        return true;
      },
    } } as unknown as Bot;
    const live = liveReply(bot, 1);
    live.push(long);
    await settle();
    await live.commit("**done**");
    expect(calls).toEqual(["MarkdownV2", "plain"]);
  });
});

// Telegram rejects a message over 4096 characters. A long answer streams into one
// message up to the part limit, then the rest arrives as further messages at commit.
describe("liveReply long answers", () => {
  function telegramLikeBot() {
    const calls: { kind: string; text: string; id?: number; mode?: string; silent?: boolean }[] = [];
    let next = 42;
    const tooLong = (text: string) => { if (text.length > 4096) throw new Error("400: Bad Request: message is too long"); };
    const api = {
      sendMessage: async (_c: number, text: string, other?: any) => {
        tooLong(text); calls.push({ kind: "send", text, mode: other?.parse_mode, silent: other?.disable_notification }); return { message_id: next++ };
      },
      editMessageText: async (_c: number, id: number, text: string, other?: any) => {
        tooLong(text); calls.push({ kind: "edit", id, text, mode: other?.parse_mode }); return true;
      },
      deleteMessage: async () => true,
    };
    return { bot: { api } as unknown as Bot, calls };
  }
  const para = (i: number) => `Point ${i} ` + Array.from({ length: 120 }, () => "word").join(" ");
  const longAnswer = Array.from({ length: 16 }, (_, i) => para(i)).join("\n\n");

  it("streams no more than one part, so no edit is ever rejected for length", async () => {
    let t = 0;
    const { bot, calls } = telegramLikeBot();
    const live = liveReply(bot, 1, { now: () => t });
    for (let i = 0; i < longAnswer.length; i += 500) {
      live.push(longAnswer.slice(i, i + 500));
      t += STREAM_EDIT_MS + 1;
      await settle();
    }
    expect(calls.length).toBeGreaterThan(2);
    for (const c of calls) expect(c.text.length).toBeLessThanOrEqual(TELEGRAM_PART_CHARS);
  });

  it("commit turns the streamed message into the first part and sends the rest silently", async () => {
    const { bot, calls } = telegramLikeBot();
    const live = liveReply(bot, 1);
    live.push(longAnswer.slice(0, 100));
    await settle();
    const id = await live.commit(longAnswer);
    expect(id).toBe(42);
    const after = calls.slice(1); // the first call is the streamed send
    expect(after[0]).toMatchObject({ kind: "edit", id: 42, mode: "MarkdownV2" });
    const rest = after.slice(1);
    expect(rest.length).toBeGreaterThan(1);
    expect(rest.every(c => c.kind === "send" && c.silent === true)).toBe(true);
    expect(after.map(c => c.text.trimEnd()).join("\n\n")).toBe(longAnswer);
  });

  it("the streamed text never shrinks while the answer is still being written", async () => {
    let t = 0;
    const { bot, calls } = telegramLikeBot();
    const live = liveReply(bot, 1, { now: () => t });
    for (let i = 0; i < longAnswer.length; i += 300) {
      live.push(longAnswer.slice(i, i + 300));
      t += STREAM_EDIT_MS + 1;
      await settle();
    }
    const lengths = calls.map(c => c.text.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
  });

  it("commit throws when a later part can't be delivered, after editing the first", async () => {
    let sends = 0;
    const edits: string[] = [];
    const bot = { api: {
      sendMessage: async () => { sends++; if (sends > 1) throw new Error("telegram down"); return { message_id: 42 }; },
      editMessageText: async (_c: number, _id: number, text: string) => { edits.push(text); return true; },
      deleteMessage: async () => true,
    } } as unknown as Bot;
    const live = liveReply(bot, 1);
    live.push(longAnswer.slice(0, 100));
    await settle();
    await expect(live.commit(longAnswer)).rejects.toThrow("telegram down");
    expect(edits.length).toBe(1);
  });

  it("commit of an answer shorter than what streamed edits it down and sends nothing more", async () => {
    let t = 0;
    const { bot, calls } = telegramLikeBot();
    const live = liveReply(bot, 1, { now: () => t });
    live.push(longAnswer.slice(0, 2000));
    await settle();
    await live.commit("Short final answer.");
    const after = calls.slice(1);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ kind: "edit", id: 42 });
  });

  it("when the final edits both fail, sends what follows the text on screen, so nothing shows twice", async () => {
    let t = 0;
    const shown: string[] = [];
    const sent: string[] = [];
    let streaming = true;
    const bot = { api: {
      sendMessage: async (_c: number, text: string) => { (streaming ? shown : sent).push(text); return { message_id: 42 }; },
      editMessageText: async (_c: number, _id: number, text: string) => {
        if (!streaming) throw new Error("400: Bad Request: message can't be edited");
        shown.push(text); return true;
      },
      deleteMessage: async () => true,
    } } as unknown as Bot;
    const live = liveReply(bot, 1, { now: () => t });
    for (let i = 0; i < longAnswer.length; i += 500) {
      live.push(longAnswer.slice(i, i + 500));
      t += STREAM_EDIT_MS + 1;
      await settle();
    }
    streaming = false;
    await live.commit(longAnswer);
    const onScreen = shown.at(-1)!;
    expect(sent.length).toBeGreaterThan(0);
    // What's on screen plus what was sent is the whole answer, nothing twice. (The stream
    // stops at a fixed length, which can fall mid-word, so compare without whitespace.)
    const bare = (x: string) => x.replace(/\s+/g, "");
    expect(bare(onScreen) + sent.map(bare).join("")).toBe(bare(longAnswer));
  });

  it("commit sends every part when nothing streamed, and returns the first id", async () => {
    const { bot, calls } = telegramLikeBot();
    const live = liveReply(bot, 1);
    const id = await live.commit(longAnswer);
    expect(id).toBe(42);
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.every(c => c.kind === "send")).toBe(true);
    expect(calls.map(c => c.text.trimEnd()).join("\n\n")).toBe(longAnswer);
  });
});

describe("liveReply prose-then-tool-call", () => {
  it("deletes the stray partial and starts clean, so the real answer notifies again", async () => {
    let t = 0;
    const { bot, calls } = fakeBot();
    const live = liveReply(bot, 1, { now: () => t });
    live.push(long);            // model started talking...
    await settle();
    live.discard();        // ...then called a tool instead
    await settle();
    expect(calls.map(c => c.kind)).toEqual(["send", "delete"]);
    expect(calls[1]!.id).toBe(42);
    expect(live.posted()).toBe(false);

    live.push(long + " real");  // the next step's genuine answer
    await settle();
    expect(calls.map(c => c.kind)).toEqual(["send", "delete", "send"]);
    expect(calls[2]!.text).toBe(long + " real"); // not concatenated onto the discarded prose
  });

  it("awaits the delete, so a dying turn can clean up before the function exits", async () => {
    // The worker calls this in its catch and then rethrows; if discard didn't
    // settle, Vercel could tear the function down mid-delete and the QStash retry
    // would stack a second partial under the orphaned first one.
    const { bot, calls } = fakeBot();
    const live = liveReply(bot, 1);
    live.push(long);
    await settle();
    await live.discard();
    expect(calls.map(c => c.kind)).toEqual(["send", "delete"]); // no settle() needed
  });

  it("never posts at all when the tool call comes before the first flush", async () => {
    const { bot, calls } = fakeBot();
    const live = liveReply(bot, 1);
    live.push("thinking");      // under STREAM_MIN_CHARS, nothing sent yet
    live.discard();
    await settle();
    expect(calls).toEqual([]);
  });
});

describe("liveReply resilience", () => {
  it("backs off after a 429 instead of hammering the chat", async () => {
    let t = 0;
    const calls: string[] = [];
    const bot = { api: {
      sendMessage: async () => ({ message_id: 5 }),
      editMessageText: async () => { calls.push("edit"); throw Object.assign(new Error("Too Many Requests"), { error_code: 429 }); },
    } } as unknown as Bot;
    const live = liveReply(bot, 1, { now: () => t });
    live.push(long);
    await settle();
    t += STREAM_EDIT_MS + 1;
    live.push("a");             // this edit 429s and doubles the interval
    await settle();
    expect(calls).toEqual(["edit"]);
    t += STREAM_EDIT_MS + 1;    // enough for the OLD interval, not the doubled one
    live.push("b");
    await settle();
    expect(calls).toEqual(["edit"]);
    t += STREAM_EDIT_MS + 1;    // now past the doubled interval
    live.push("c");
    await settle();
    expect(calls).toEqual(["edit", "edit"]);
  });

  it("swallows streaming errors — progress failing must never fail the turn", async () => {
    const boom = async () => { throw new Error("telegram down"); };
    const bot = { api: { sendMessage: boom, editMessageText: boom, deleteMessage: boom } } as unknown as Bot;
    const live = liveReply(bot, 1);
    expect(() => { live.push(long); live.discard(); }).not.toThrow();
    await settle();
    expect(live.posted()).toBe(false);
  });

  it("keeps the answer when only the final formatting fails", async () => {
    // The streamed plain text is already on screen and correct — losing MarkdownV2
    // is cosmetic, so commit must not turn it into a failed turn.
    const bot = { api: {
      sendMessage: async () => ({ message_id: 9 }),
      editMessageText: async () => { throw new Error("can't parse entities"); },
    } } as unknown as Bot;
    const live = liveReply(bot, 1);
    live.push(long);
    await settle();
    await expect(live.commit("**done**")).resolves.toBe(9);
  });

  it("PROPAGATES when the answer could not be delivered at all", async () => {
    // Nothing streamed and the send fails outright: the turn produced no visible
    // output. Swallowing that would silently lose the reply — exactly what this
    // feature exists to prevent. Throwing lets QStash retry, then apologise.
    const boom = async () => { throw new Error("telegram down"); };
    const bot = { api: { sendMessage: boom, editMessageText: boom } } as unknown as Bot;
    const live = liveReply(bot, 1);
    await expect(live.commit("final")).rejects.toThrow("telegram down");
  });
});

describe("startTyping", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("shows typing immediately and keeps refreshing until stopped", async () => {
    vi.useFakeTimers();
    const { bot, calls } = fakeBot();
    const stop = startTyping(bot, 1);
    expect(calls.map(c => c.kind)).toEqual(["action"]);   // instant, no wait
    await vi.advanceTimersByTimeAsync(TYPING_REFRESH_MS * 2 + 1);
    expect(calls.length).toBe(3);
    stop();
    await vi.advanceTimersByTimeAsync(TYPING_REFRESH_MS * 3);
    expect(calls.length).toBe(3);                          // stopped means stopped
  });

  it("survives a failing sendChatAction", async () => {
    vi.useFakeTimers();
    const bot = { api: { sendChatAction: async () => { throw new Error("nope"); } } } as unknown as Bot;
    const stop = startTyping(bot, 1);
    await vi.advanceTimersByTimeAsync(TYPING_REFRESH_MS + 1);
    stop();
  });
});
