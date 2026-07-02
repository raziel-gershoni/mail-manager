// Fan the poll out over every user with a linked Google account.
import type { TelegramLinkRepo, UserDirectory } from "../users/identity.js";
import { ensureOwnerLink } from "../users/identity.js";

export interface FanoutDeps {
  ownerTelegramId: number;
  links: TelegramLinkRepo;
  directory: UserDirectory;
  pollUser: (userId: number, chatId: number) => Promise<void>;
}

export async function pollAllUsers(deps: FanoutDeps): Promise<{ polled: number; skipped: number; errored: number }> {
  await ensureOwnerLink(deps.ownerTelegramId, deps.links, deps.directory);
  const userIds = await deps.directory.usersWithGoogleAccount();
  let polled = 0, skipped = 0, errored = 0;
  for (const userId of userIds) {
    const link = await deps.links.getByUserId(userId);
    if (!link) { skipped++; continue; }             // no chat to deliver to
    try { await deps.pollUser(userId, link.chatId); polled++; }
    catch (e) { errored++; console.error(`poll failed for user ${userId}`, e); }
  }
  return { polled, skipped, errored };
}
