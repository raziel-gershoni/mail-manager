import { Client, Receiver } from "@upstash/qstash";
import type { Env } from "../config/env.js";

export function buildDestination(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, "") + path;
}

export async function enqueue(env: Env, path: "/api/worker", body: unknown): Promise<void> {
  const client = new Client({ token: env.QSTASH_TOKEN });
  await client.publishJSON({ url: buildDestination(env.APP_BASE_URL, path), body });
}

export async function verifyQStash(env: Env, req: Request): Promise<unknown> {
  const signature = req.headers.get("upstash-signature") ?? "";
  const bodyText = await req.text();
  const receiver = new Receiver({
    currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
  });
  const valid = await receiver.verify({ signature, body: bodyText });
  if (!valid) throw new Error("invalid qstash signature");
  return bodyText ? JSON.parse(bodyText) : {};
}

// The inbox poll's cadence: on the hour, every hour. The prose the OWNER reads
// describes this interval in several places — keep them in sync when it changes:
// src/i18n/messages.ts (intro), src/telegram/bot.ts (system prompt),
// src/notifier/activity.ts, src/agent/tools.ts (recent_activity), README.
export const POLL_CRON = "0 * * * *";

export type SchedulePlan =
  | { kind: "ok"; scheduleId: string }
  | { kind: "create" }
  | { kind: "replace"; stale: string[] };

// What /api/setup must do to make QStash match POLL_CRON. Pure, so the whole
// reconciliation is testable without the network. QStash has no "update cron"
// call, so a changed POLL_CRON is a delete + create — without this, editing the
// constant would silently never reach a deployment whose schedule already
// exists. "replace" also covers duplicate schedules for one destination (they
// would double-deliver every cycle): drop them all, create exactly one.
export function planPollSchedule(
  existing: { scheduleId: string; cron: string; destination: string }[],
  destination: string,
  cron: string,
): SchedulePlan {
  const matches = existing.filter(s => s.destination === destination);
  if (matches.length === 0) return { kind: "create" };
  if (matches.length === 1 && matches[0]!.cron === cron) return { kind: "ok", scheduleId: matches[0]!.scheduleId };
  return { kind: "replace", stale: matches.map(s => s.scheduleId) };
}

export async function ensurePollSchedule(env: Env): Promise<{ created: boolean; replaced: boolean; destination: string; cron: string; scheduleId?: string }> {
  const destination = buildDestination(env.APP_BASE_URL, "/api/poll");
  const client = new Client({ token: env.QSTASH_TOKEN });
  const plan = planPollSchedule(await client.schedules.list(), destination, POLL_CRON);
  if (plan.kind === "ok") return { created: false, replaced: false, destination, cron: POLL_CRON, scheduleId: plan.scheduleId };
  const stale = plan.kind === "replace" ? plan.stale : [];
  // Delete BEFORE creating: two live schedules on one destination would double
  // every digest, whereas the gap between the two calls costs at most one skipped
  // cycle — and no mail with it, since the Gmail cursor makes the next poll cover
  // the longer window. If the create below fails, re-running /api/setup finishes
  // the job (no schedule matches, so it creates one).
  for (const id of stale) await client.schedules.delete(id);
  const { scheduleId } = await client.schedules.create({ destination, cron: POLL_CRON });
  return { created: true, replaced: stale.length > 0, destination, cron: POLL_CRON, scheduleId };
}
