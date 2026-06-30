export interface DigestItem { messageId: string; from: string; subject: string; reason: string; }
export interface TgButton { text: string; callbackData: string; }
export interface TgMessage { text: string; buttons: TgButton[][]; }

function row(it: DigestItem): string {
  const subj = it.subject || "(no subject)";
  return `• *${escapeMd(subj)}*\n  ${escapeMd(it.from)} — _${escapeMd(it.reason)}_`;
}
function escapeMd(s: string): string { return s.replace(/([*_`\[\]])/g, "\\$1"); }

export function buildImportantDigest(items: DigestItem[]): TgMessage | null {
  if (items.length === 0) return null;
  const text = `📬 *${items.length} new important* email(s):\n\n` + items.map(row).join("\n\n");
  const buttons = items.map(it => [{ text: "🗑 Not important", callbackData: `ni:${it.messageId}` }]);
  return { text, buttons };
}

export function buildReviewDigest(items: DigestItem[]): TgMessage | null {
  if (items.length === 0) return null;
  const text = `🔍 Recently *set aside* (the bot wasn't sure):\n\n` + items.map(row).join("\n\n");
  const buttons = items.map(it => [{ text: "⭐ Actually important", callbackData: `ai:${it.messageId}` }]);
  return { text, buttons };
}
