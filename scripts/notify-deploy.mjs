// Best-effort Telegram ping to the owner when a Vercel build succeeds.
// Runs at the end of `vercel-build` (after tsc + migrate), so it only fires when the
// build is green. Always exits 0 — a failed ping must never fail the deploy.
const token = process.env.TELEGRAM_BOT_TOKEN;
const owner = process.env.TELEGRAM_OWNER_ID;

if (!token || !owner) {
  console.log("notify-deploy: TELEGRAM_BOT_TOKEN/OWNER_ID missing, skipping");
  process.exit(0);
}

const sha = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7);
const msg = (process.env.VERCEL_GIT_COMMIT_MESSAGE || "").split("\n")[0];
const base = process.env.APP_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
const text = ["🚀 mail-manager build succeeded — deploying" + (sha ? ` ${sha}` : ""), msg, base]
  .filter(Boolean)
  .join("\n");

try {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: Number(owner), text, disable_web_page_preview: true }),
  });
  console.log(`notify-deploy: telegram responded ${res.status}`);
} catch (err) {
  console.log("notify-deploy failed (non-fatal):", err && err.message ? err.message : err);
}
process.exit(0);
