// src/db/user-adapters.ts
import { eq, min } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { TelegramLink, TelegramLinkRepo, UserDirectory } from "../users/identity.js";

export function dbTelegramLinkRepo(): TelegramLinkRepo {
  return {
    async getByTelegramUserId(telegramUserId) {
      const [r] = await db().select().from(schema.telegramLinks)
        .where(eq(schema.telegramLinks.telegramUserId, telegramUserId)).limit(1);
      return r ? { userId: r.userId, chatId: r.chatId } : null;
    },
    async getByUserId(userId) {
      const [r] = await db().select().from(schema.telegramLinks)
        .where(eq(schema.telegramLinks.userId, userId)).limit(1);
      return r ? { telegramUserId: r.telegramUserId, chatId: r.chatId } : null;
    },
    async upsert(link: TelegramLink) {
      await db().insert(schema.telegramLinks)
        .values({ userId: link.userId, telegramUserId: link.telegramUserId, chatId: link.chatId })
        .onConflictDoUpdate({
          target: schema.telegramLinks.telegramUserId,
          set: { userId: link.userId, chatId: link.chatId },
        });
    },
  };
}

export function dbUserDirectory(): UserDirectory {
  return {
    async usersWithGoogleAccount() {
      const rows = await db().selectDistinct({ userId: schema.googleAccounts.userId }).from(schema.googleAccounts);
      return rows.map(r => r.userId).sort((a, b) => a - b);
    },
    async ownerUserId() {
      const [r] = await db().select({ owner: min(schema.googleAccounts.userId) }).from(schema.googleAccounts);
      return r?.owner ?? null;
    },
  };
}
