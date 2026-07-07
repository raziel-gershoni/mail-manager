// Second-user provisioning: pure input validation + a DI-friendly orchestrator.
// The owner (admin) creates the shell (user + telegram link + language + a consent
// state) and hands the returned consent URL to the second user, who grants access
// to THEIR OWN Gmail — the token is minted by Google from their consent, never here.
import type { Lang } from "../i18n/index.js";
import type { TelegramLinkRepo } from "../users/identity.js";
import type { SettingsRepo } from "../settings/settings.js";
import type { OAuthStateRepo } from "./reconnect.js";

export interface ProvisionInput { telegramUserId: number; language: Lang; }

export function parseProvisionBody(body: unknown): ProvisionInput | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "invalid body" };
  const p = body as Record<string, unknown>;
  if (typeof p.telegramUserId !== "number" || !Number.isInteger(p.telegramUserId)) return { error: "invalid telegramUserId" };
  if (p.language !== "en" && p.language !== "he") return { error: "invalid language" };
  return { telegramUserId: p.telegramUserId, language: p.language };
}

export interface ProvisionDeps {
  createUser: () => Promise<number>;
  links: TelegramLinkRepo;
  settings: SettingsRepo;
  states: OAuthStateRepo;
  buildConsentUrl: (state: string) => string;
  genState: () => string;
  ttlMs: number;
}

export async function provisionUser(
  deps: ProvisionDeps,
  input: ProvisionInput,
  now: Date,
): Promise<{ userId: number; consentUrl: string } | { error: string }> {
  // Reject a Telegram id that's already linked rather than silently re-pointing it.
  if (await deps.links.getByTelegramUserId(input.telegramUserId)) return { error: "telegram id already linked" };
  const userId = await deps.createUser();
  // In a private chat, chat.id === from.id, so the Telegram user id doubles as the chat id.
  await deps.links.upsert({ userId, telegramUserId: input.telegramUserId, chatId: input.telegramUserId });
  await deps.settings.upsert(userId, { timezone: null, digestStartHour: 0, digestEndHour: 24, paused: false, language: input.language });
  const state = deps.genState();
  await deps.states.create(state, userId, new Date(now.getTime() + deps.ttlMs));
  return { userId, consentUrl: deps.buildConsentUrl(state) };
}
