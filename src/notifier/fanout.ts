// Fan the poll out over every user with a linked Google account, respecting per-user settings.
import type { TelegramLinkRepo, UserDirectory } from "../users/identity.js";
import { ensureOwnerLink } from "../users/identity.js";
import type { EffectiveSettings } from "../settings/settings.js";
import { isActiveDay, isWithinDigestWindow } from "../settings/window.js";

// How long each user's poll may keep taking on new mail, measured from the start of the
// run. The rest of the 300s maxDuration (~100s) covers that user's guarded/preference
// vets, the brief, sending and committing, plus one slow in-flight Gemini call (40s
// HTTP timeout). Users are polled concurrently, so each gets this same window instead
// of waiting behind the others.
export const POLL_LOOP_BUDGET_MS = 200_000;

export interface FanoutDeps {
  ownerTelegramId: number;
  links: TelegramLinkRepo;
  directory: UserDirectory;
  now: Date;
  settingsFor: (userId: number) => Promise<EffectiveSettings>;
  pollUser: (userId: number, chatId: number, timezone: string, language: EffectiveSettings["language"], deadline: number) => Promise<void>;
}

type Outcome = "polled" | "skipped" | "gated" | "errored";

export async function pollAllUsers(deps: FanoutDeps): Promise<{ polled: number; skipped: number; gated: number; errored: number }> {
  await ensureOwnerLink(deps.ownerTelegramId, deps.links, deps.directory);
  const userIds = await deps.directory.usersWithGoogleAccount();
  const deadline = deps.now.getTime() + POLL_LOOP_BUDGET_MS;
  // Every user at once, each fully isolated: with concurrency an escaping rejection would
  // abandon the other users' in-flight polls, so ANY failure is caught and counted here.
  const outcomes = await Promise.all(userIds.map(async (userId): Promise<Outcome> => {
    try {
      const link = await deps.links.getByUserId(userId);
      if (!link) return "skipped";                                    // no chat to deliver to
      const s = await deps.settingsFor(userId);
      if (s.paused || !isActiveDay(deps.now, s.timezone, s.activeDays)
        || !isWithinDigestWindow(deps.now, s.timezone, s.digestStartHour, s.digestEndHour)) return "gated";
      await deps.pollUser(userId, link.chatId, s.timezone, s.language, deadline);
      return "polled";
    } catch (e) {
      console.error(`poll failed for user ${userId}`, e);
      return "errored";
    }
  }));
  const count = (o: Outcome) => outcomes.filter(x => x === o).length;
  return { polled: count("polled"), skipped: count("skipped"), gated: count("gated"), errored: count("errored") };
}
