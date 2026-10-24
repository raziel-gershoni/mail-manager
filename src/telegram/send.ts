import type { Bot } from "grammy";
import telegramifyMarkdown from "telegramify-markdown";
import { log } from "../util/log.js";

// Telegram rejects a message over 4096 characters (counted as shown, after MarkdownV2
// parsing), so longer text goes out as several messages.
export const TELEGRAM_MAX_CHARS = 4096;
// The usual size of a part, in UTF-16 code units (a count that never undercounts
// Telegram's own). The margin is for the MarkdownV2 render, which can show more than the
// Markdown it came from: a "- " bullet becomes "•   ". messageParts cuts smaller where
// the margin isn't enough.
export const TELEGRAM_PART_CHARS = 3500;

const FENCE = /^ {0,3}```/;
const CLOSE_FENCE = "\n```";

// The opening line of a ``` code block that `text` leaves open, or null. The language tag
// is kept (clipped) so the reopened block highlights the same way.
function openFence(text: string): string | null {
  let open: string | null = null;
  for (const line of text.split("\n")) {
    if (!FENCE.test(line)) continue;
    open = open === null ? line.trim().slice(0, 24) : null;
  }
  return open;
}

// Where to cut `rest` (longer than `max`): the last paragraph break in the second half of
// the window, else the last line break, else the last space, else a hard cut that never
// splits an emoji's surrogate pair. `gap` is the break to drop from the next part.
function findCut(rest: string, max: number): { cut: number; gap: RegExp } {
  const window = rest.slice(0, max + 1); // +1: a break right at `max` still counts
  const late = (i: number) => i >= max / 2;
  let cut = window.lastIndexOf("\n\n");
  if (late(cut)) return { cut, gap: /^\n+/ };
  cut = window.lastIndexOf("\n");
  if (late(cut)) return { cut, gap: /^\n+/ };
  cut = window.lastIndexOf(" ");
  if (late(cut)) return { cut, gap: /^ / };
  cut = max;
  const code = rest.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1; // don't separate an emoji's halves
  return { cut: Math.max(cut, Math.min(2, rest.length)), gap: /^$/ };
}

// Cuts `text` into parts of at most `max` code units where a reader would pause (see
// findCut). A ``` code block that a cut falls inside is closed at the end of the part and
// reopened at the start of the next, so each part renders on its own. Pure.
export function splitMessage(text: string, max: number = TELEGRAM_PART_CHARS): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let { cut, gap } = findCut(rest, max);
    let open = openFence(rest.slice(0, cut));
    // Only where the reopened fence line is small next to a part, so `rest` still shrinks.
    if (open !== null && (open.length + CLOSE_FENCE.length) * 8 < max) {
      ({ cut, gap } = findCut(rest, max - CLOSE_FENCE.length));
      open = openFence(rest.slice(0, cut));
    } else open = null;
    // Only the break itself is dropped: an indented line that starts the next part keeps
    // its indentation.
    let part = rest.slice(0, cut).trimEnd();
    rest = rest.slice(cut).replace(gap, "");
    if (open !== null) { part += CLOSE_FENCE; rest = `${open}\n${rest}`; }
    if (part) parts.push(part);
  }
  // Whitespace-only or empty text stays one part, as before: Telegram rejects it and the
  // caller hears about it, instead of nothing being sent without a word.
  if (rest.trim() || parts.length === 0) parts.push(rest);
  return parts;
}

// How long the MarkdownV2 render of `part` is as Telegram counts it, from above: each
// escape counts once and markup characters are still counted.
function renderedLength(part: string): number {
  try {
    return telegramifyMarkdown(part, "escape").replace(/\\([\s\S])/g, "$1").length;
  } catch (err) {
    // The send falls back to plain text for this part anyway, and plain fits.
    log("telegram.render_measure_failed", { error: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}

// The parts a message is sent as: splitMessage's, with any part whose render would still
// be too long (list-heavy text) cut again at half the size. Pure.
export function messageParts(text: string, max: number = TELEGRAM_PART_CHARS): string[] {
  return splitMessage(text, max).flatMap(part =>
    max > 256 && renderedLength(part) > TELEGRAM_MAX_CHARS ? messageParts(part, Math.floor(max / 2)) : [part]);
}

// grammy surfaces Telegram's error_code on GrammyError; 429 is "slow down".
export function isRateLimited(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { error_code?: number }).error_code === 429;
}

// One part: rendered as MarkdownV2, or as plain text if conversion or the formatted
// send fails, so the part lands. Throws if both sends fail. A 429 that outlasted the
// client's retries (src/telegram/client.ts) is thrown straight away: a plain send would
// hit the same limit and only spend more of the run's time.
async function sendPart(bot: Bot, chatId: number, text: string, silent: boolean): Promise<number> {
  const extra = silent ? { disable_notification: true } : {};
  try {
    const md = telegramifyMarkdown(text, "escape");
    const m = await bot.api.sendMessage(chatId, md, { parse_mode: "MarkdownV2", ...extra });
    return m.message_id;
  } catch (err) {
    if (isRateLimited(err)) throw err;
    log("telegram.format_fallback", { error: err instanceof Error ? err.message : String(err) });
    const m = await bot.api.sendMessage(chatId, text, extra);
    return m.message_id;
  }
}

// Sends parts in order. Only the first can notify (`silent` decides), so a long message
// buzzes once. Throws as soon as a part can't be delivered either way: the caller retries
// the whole message rather than leave its tail missing.
export async function sendParts(bot: Bot, chatId: number, parts: string[], silent: boolean): Promise<number[]> {
  const ids: number[] = [];
  for (const [i, part] of parts.entries()) {
    try {
      ids.push(await sendPart(bot, chatId, part, silent || i > 0));
    } catch (err) {
      log("telegram.part_failed", { part: i + 1, of: parts.length, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }
  return ids;
}

// The LLM emits Markdown. Render it in Telegram by converting to (safely-escaped)
// MarkdownV2, one message per part (see messageParts).
// Returns the sent message ids in order (used to couple a digest to the emails it
// covered, so a reply to any part resolves). Throws if a part can't be delivered.
// Both senders send text.toWellFormed(): a lone UTF-16 surrogate (half an emoji, from a
// cut somewhere upstream) makes Telegram reject the whole message, so it becomes U+FFFD.
export async function sendFormatted(bot: Bot, chatId: number, raw: string, opts?: { silent?: boolean }): Promise<number[]> {
  return sendParts(bot, chatId, messageParts(raw.toWellFormed()), opts?.silent ?? false);
}

// For a message the bot composes itself around UNTRUSTED email text (the weekly reports:
// senders, subjects, model reasons) and that has no markdown of its own. It goes out as
// plain text, with no parse_mode or entities. What that PREVENTS: markup the text carries
// — a hidden link behind anchor text ("[Verify](https://phish)" shows literally), a
// markdown mailto link, bold/italic. What it does NOT prevent: Telegram's own detection,
// which still makes a bare URL or domain, an email address, an @mention, a /command (a
// tapped one is sent to the bot), a #hashtag or a phone number tappable in plain text.
// So the weekly reports defang every untrusted field first (src/weekly/text.ts, defang):
// URLs, domains, emails, @mentions and /commands become readable non-links. A #hashtag
// (an in-app search) and a phone number are left as they are.
// Link previews are off as well, so a URL that slips through isn't fetched and shown as a
// card. Unlike sendFormatted it doesn't split, so the caller keeps the text under 4096 characters.
export async function sendPlain(bot: Bot, chatId: number, text: string, opts?: { silent?: boolean }): Promise<number> {
  const m = await bot.api.sendMessage(chatId, text.toWellFormed(), {
    link_preview_options: { is_disabled: true },
    ...(opts?.silent ? { disable_notification: true } : {}),
  });
  return m.message_id;
}
