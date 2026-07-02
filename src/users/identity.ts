// Identity resolution for multi-user routing. Pure logic over repo interfaces.
export interface TelegramLink { userId: number; telegramUserId: number; chatId: number; }

export interface TelegramLinkRepo {
  getByTelegramUserId(telegramUserId: number): Promise<{ userId: number; chatId: number } | null>;
  getByUserId(userId: number): Promise<{ telegramUserId: number; chatId: number } | null>;
  upsert(link: TelegramLink): Promise<void>;
}

export interface UserDirectory {
  usersWithGoogleAccount(): Promise<number[]>;
  ownerUserId(): Promise<number | null>; // the bootstrap owner: lowest user id that has a Google account
}

// Resolve the acting user for an inbound Telegram message, or null if unauthorized.
// A known link wins. Otherwise, only the owner id bootstraps — lazily creating the
// owner's link (capturing the real chatId). Unlinked non-owner ids get null.
export async function resolveUserForTelegram(
  ownerTelegramId: number, telegramUserId: number, chatId: number,
  links: TelegramLinkRepo, directory: UserDirectory,
): Promise<number | null> {
  const existing = await links.getByTelegramUserId(telegramUserId);
  if (existing) return existing.userId;
  if (telegramUserId === ownerTelegramId) {
    const ownerUserId = await directory.ownerUserId();
    if (ownerUserId === null) return null;
    await links.upsert({ userId: ownerUserId, telegramUserId, chatId });
    return ownerUserId;
  }
  return null;
}

// Cheap authorization gate (read-only). Owner short-circuits with no DB read.
export async function isAuthorizedTelegram(
  ownerTelegramId: number, telegramUserId: number, links: TelegramLinkRepo,
): Promise<boolean> {
  if (telegramUserId === ownerTelegramId) return true;
  return (await links.getByTelegramUserId(telegramUserId)) !== null;
}

// Ensure the owner has a telegram_links row so the poll can deliver briefs even
// before the owner next messages the bot. chatId bootstraps to ownerTelegramId
// (private-chat identity: chat.id === from.id).
export async function ensureOwnerLink(
  ownerTelegramId: number, links: TelegramLinkRepo, directory: UserDirectory,
): Promise<void> {
  if (await links.getByTelegramUserId(ownerTelegramId)) return;
  const ownerUserId = await directory.ownerUserId();
  if (ownerUserId === null) return;
  await links.upsert({ userId: ownerUserId, telegramUserId: ownerTelegramId, chatId: ownerTelegramId });
}

export function fakeTelegramLinkRepo(seed: TelegramLink[] = []): TelegramLinkRepo & { all(): TelegramLink[] } {
  const rows: TelegramLink[] = [...seed];
  return {
    async getByTelegramUserId(tg) { const r = rows.find(x => x.telegramUserId === tg); return r ? { userId: r.userId, chatId: r.chatId } : null; },
    async getByUserId(uid) { const r = rows.find(x => x.userId === uid); return r ? { telegramUserId: r.telegramUserId, chatId: r.chatId } : null; },
    async upsert(link) { const i = rows.findIndex(x => x.telegramUserId === link.telegramUserId); if (i >= 0) rows[i] = link; else rows.push(link); },
    all() { return [...rows]; },
  };
}

export function fakeUserDirectory(userIds: number[] = []): UserDirectory {
  return {
    async usersWithGoogleAccount() { return [...userIds]; },
    async ownerUserId() { return userIds.length ? Math.min(...userIds) : null; },
  };
}
