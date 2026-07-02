// Sends ONE Telegram message to the owner on a successful production deploy.
// Runs at build time (Next builds once, so this fires once). Never fails the build.
// Canonical logic is tested in src/deploy/notify.ts; this mirrors it.
if (process.env.VERCEL_ENV !== "production") process.exit(0);

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_OWNER_ID;
if (!token || !chatId) process.exit(0);

const short = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7);
const text = `🚀 mail-manager deployed${short ? ` (${short})` : ""}.`;

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 5000);
try {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: Number(chatId), text }),
    signal: controller.signal,
  });
} catch {
  // swallow — a failed or slow ping must never break the deploy
} finally {
  clearTimeout(timer);
}
process.exit(0);
