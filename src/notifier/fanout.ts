// Fan the poll out over every user with a linked Google account, respecting per-user settings.
import type { TelegramLinkRepo, UserDirectory } from "../users/identity.js";
import { ensureOwnerLink } from "../users/identity.js";
import type { EffectiveSettings } from "../settings/settings.js";
import { isWithinDigestWindow } from "../settings/window.js";

export interface FanoutDeps {
  ownerTelegramId: number;
  links: TelegramLinkRepo;
  directory: UserDirectory;
  now: Date;
  settingsFor: (userId: number) => Promise<EffectiveSettings>;
  pollUser: (userId: number, chatId: number, timezone: string) => Promise<void>;
}

export async function pollAllUsers(deps: FanoutDeps): Promise<{ polled: number; skipped: number; gated: number; errored: number }> {
  await ensureOwnerLink(deps.ownerTelegramId, deps.links, deps.directory);
  const userIds = await deps.directory.usersWithGoogleAccount();
  let polled = 0, skipped = 0, gated = 0, errored = 0;
  for (const userId of userIds) {
    const link = await deps.links.getByUserId(userId);
    if (!link) { skipped++; continue; }                                // no chat to deliver to
    const s = await deps.settingsFor(userId);
    if (s.paused || !isWithinDigestWindow(deps.now, s.timezone, s.digestStartHour, s.digestEndHour)) { gated++; continue; }
    try { await deps.pollUser(userId, link.chatId, s.timezone); polled++; }
    catch (e) { errored++; console.error(`poll failed for user ${userId}`, e); }
  }
  return { polled, skipped, gated, errored };
}
