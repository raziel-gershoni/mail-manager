// app/api/setup/route.ts
import { env } from "../../../src/config/env.js";
import { isSetupAuthorized } from "../../../src/setup/auth.js";
import { ensurePollSchedule } from "../../../src/queue/qstash.js";
import { ensureTelegramWebhook } from "../../../src/telegram/bot.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const e = env();
  const expected = e.SETUP_SECRET;
  if (!expected) return new Response("setup not configured", { status: 500 });
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") || null;
  if (!isSetupAuthorized(provided, expected)) return new Response("forbidden", { status: 403 });

  const out: { ok: boolean; schedule?: unknown; webhook?: unknown } = { ok: true };
  try {
    out.schedule = await ensurePollSchedule(e);
  } catch (err) {
    console.error("setup: schedule step failed", err);
    return Response.json({ ok: false, step: "schedule", error: (err as Error).message }, { status: 500 });
  }
  try {
    out.webhook = await ensureTelegramWebhook(e);
  } catch (err) {
    console.error("setup: webhook step failed", err);
    return Response.json({ ok: false, step: "webhook", error: (err as Error).message }, { status: 500 });
  }
  return Response.json(out);
}
