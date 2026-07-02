// Telegram Mini App initData verification (HMAC-SHA256, per Telegram's WebApp spec).
// This is the auth boundary: a valid result means the request genuinely came from
// this bot's Mini App for the returned Telegram user.
import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;

export function verifyInitData(
  initData: string, botToken: string, now: Date, maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): { telegramUserId: number } | null {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  // data_check_string: every field except `hash`, "key=value", sorted by key, joined by "\n"
  // (URLSearchParams yields URL-decoded values, which is what Telegram signs).
  const pairs: string[] = [];
  for (const [k, v] of params.entries()) if (k !== "hash") pairs.push(`${k}=${v}`);
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secret).update(dataCheckString).digest("hex");

  let ok = false;
  try {
    const a = Buffer.from(computed, "hex");
    const b = Buffer.from(hash, "hex");
    ok = a.length === b.length && timingSafeEqual(a, b);
  } catch { return null; }
  if (!ok) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) return null;
  if (now.getTime() - authDate * 1000 >= maxAgeMs) return null;

  const userJson = params.get("user");
  if (!userJson) return null;
  let telegramUserId: number;
  try { telegramUserId = Number((JSON.parse(userJson) as { id: unknown }).id); } catch { return null; }
  if (!Number.isFinite(telegramUserId)) return null;

  return { telegramUserId };
}
