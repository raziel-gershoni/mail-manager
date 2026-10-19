// src/weekly/retro.ts
// The weekly retrospect: what the bot did over the last 7 days, a second look at what it
// trashed or archived, and the operational issues it hit. Read-only on mail: restoring
// is the owner's call, by replying "restore 1" / "restore all" to the report.
import type { DigestRef } from "../notifier/refs.js";
import { t, type Lang, type MsgKey } from "../i18n/index.js";
import { OPS_RETENTION_MS, type OpsEvent, type OpsEventKind } from "../ops/events.js";
import { log } from "../util/log.js";
import { gatherWeek, retroSince, retroUntil, type WeekFacts } from "./gather.js";
import { secondLook, checkableActed, SECOND_LOOK_CAP, type SecondLook } from "./second-look.js";
import type { WeeklyDeps } from "./run.js";

// At most this many "worth a look" items are numbered (R8), and the whole message stays
// under this many characters: the weekly send (sendPlain) doesn't split, Telegram rejects
// anything over 4096, and a report that can't be sent never sets the week's key — it
// would retry every hour. Overflow becomes "+N more — ask me".
export const RETRO_MAX_LISTED = 20;
export const RETRO_MAX_CHARS = 3800;
const TOP_SENDERS = 3;
const FROM_MAX = 60;
const SUBJECT_MAX = 80;
const REASON_MAX = 100;

const OPS_ORDER: readonly OpsEventKind[] = ["poll_incomplete", "cursor_expired", "reconnect_needed", "poll_errored", "worker_failed"];
const OPS_KEY: Record<OpsEventKind, MsgKey> = {
  poll_incomplete: "retro_ops_incomplete",
  cursor_expired: "retro_ops_cursor",
  reconnect_needed: "retro_ops_reconnect",
  poll_errored: "retro_ops_errored",
  worker_failed: "retro_ops_worker",
};

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function senderKey(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1]! : from).trim().toLowerCase();
}

// "a@x.com (40), b@y.com (12), c@z.com (5)": the top senders by count, a tie kept in the
// order first seen. A row with no sender (a chat-acted message that couldn't be read
// back) is skipped.
function topSenders(items: ReadonlyArray<{ from: string }>): string {
  const counts = new Map<string, number>();
  for (const i of items) {
    const k = senderKey(i.from);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_SENDERS)
    .map(([k, n]) => `${clip(k, FROM_MAX)} (${n})`).join(", ");
}

function opsLines(events: readonly OpsEvent[], lang: Lang): string[] {
  const counts = new Map<OpsEventKind, number>();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return OPS_ORDER.filter(k => counts.has(k)).map(k => `• ${t(lang, OPS_KEY[k], { n: counts.get(k)! })}`);
}

export function composeRetroReport(facts: WeekFacts, look: SecondLook, lang: Lang): { text: string; silent: boolean; refs: DigestRef[] } {
  const trashed = facts.acted.filter(a => a.action === "trashed");
  const archived = facts.acted.filter(a => a.action === "archived");
  const head = [
    t(lang, "retro_head", { trashed: trashed.length, archived: archived.length, rescued: facts.rescued, undone: facts.undone, rules: facts.rulesNew })
      + (facts.rulesChanged > 0 ? t(lang, "retro_rules_changed", { n: facts.rulesChanged }) : ""),
  ];
  const topTrashed = topSenders(trashed);
  if (topTrashed) head.push(t(lang, "retro_top_trashed", { list: topTrashed }));
  const topArchived = topSenders(archived);
  if (topArchived) head.push(t(lang, "retro_top_archived", { list: topArchived }));

  const checkable = checkableActed(facts).length;
  const tail: string[] = [];
  const ops = opsLines(facts.ops, lang);
  if (ops.length > 0) tail.push("", t(lang, "retro_ops_head"), ...ops);
  const notes: string[] = [];
  if (look.unjudged > 0) notes.push(t(lang, "retro_unjudged", { n: look.unjudged }));
  if (look.capped && checkable > SECOND_LOOK_CAP) notes.push(t(lang, "retro_not_checked", { n: checkable - SECOND_LOOK_CAP }));
  if (look.skippedGone > 0) notes.push(t(lang, "retro_gone", { n: look.skippedGone }));
  const legacy = facts.acted.filter(a => !a.messageId).length;
  if (legacy > 0) notes.push(t(lang, "retro_legacy", { n: legacy }));
  if (look.incomplete) notes.push(t(lang, "retro_incomplete"));
  if (notes.length > 0) tail.push("", `_${notes.join(" · ")}_`);

  // The numbered list and its refs are built together, so number n is always refs[n-1].
  const render = (k: number): { text: string; refs: DigestRef[] } => {
    const listed = look.flagged.slice(0, k);
    const middle: string[] = [];
    if (look.flagged.length > 0) {
      middle.push("", t(lang, "retro_worth_look"));
      listed.forEach((f, i) => {
        const verb = t(lang, f.action === "trashed" ? "retro_item_trashed" : "retro_item_archived");
        const subject = clip(f.subject, SUBJECT_MAX) || t(lang, "poll_no_subject");
        const reason = f.reason.trim() ? ` (${clip(f.reason.trim(), REASON_MAX)})` : "";
        middle.push(`${i + 1}. ${verb} — ${clip(f.from, FROM_MAX)} — ${subject}${reason}`);
      });
      if (look.flagged.length > k) middle.push(t(lang, "retro_more", { n: look.flagged.length - k }));
      if (k > 0) middle.push(t(lang, "retro_reply_hint"));
    } else if (Math.min(checkable, SECOND_LOOK_CAP) > look.unjudged + look.skippedGone) {
      middle.push("", t(lang, "retro_nothing_wrong"));
    }
    return {
      text: [...head, ...middle, ...tail].join("\n"),
      refs: listed.map(f => ({ id: f.id, from: f.from, subject: f.subject, kind: f.action })),
    };
  };
  let k = Math.min(look.flagged.length, RETRO_MAX_LISTED);
  let out = render(k);
  while (k > 0 && out.text.length > RETRO_MAX_CHARS) out = render(--k);
  // Buzz only when there is something to act on or worry about.
  return { text: out.text, silent: look.flagged.length === 0 && facts.ops.length === 0, refs: out.refs };
}

// The "retro" weekly kind. Prunes ops events past 30 days on the way (they matter only
// to this report), then gathers the window, takes the second look within `deadline`,
// and composes the report. runWeeklyTasks sends it, saves its refs, then marks the week.
export async function retroReport(deps: WeeklyDeps, deadline: number): Promise<{ text: string; silent: boolean; refs: DigestRef[] }> {
  const { activity, actionLog, ops } = deps;
  if (!activity || !actionLog || !ops) throw new Error("retro deps unavailable");
  const now = new Date(deps.now());
  try {
    await ops.prune(new Date(now.getTime() - OPS_RETENTION_MS));
  } catch (err) {
    log("weekly.ops_prune_failed", { userId: deps.userId, error: err instanceof Error ? err.message : String(err) });
  }
  // The window is the previous Sunday–Saturday week (C2): both edges, so this week's
  // activity so far waits for next week's report.
  const facts = await gatherWeek({ userId: deps.userId, since: retroSince(now, deps.timezone), until: retroUntil(now, deps.timezone),
    activity, actionLog, store: deps.store, ops });
  const look = await secondLook(facts, { gmail: deps.gmail, llm: deps.llm, deadline, now: deps.now });
  log("weekly.retro", { userId: deps.userId, acted: facts.acted.length, flagged: look.flagged.length, unjudged: look.unjudged,
    skippedGone: look.skippedGone, capped: look.capped, incomplete: look.incomplete, ops: facts.ops.length });
  return composeRetroReport(facts, look, deps.language);
}
